// Presety syntezowane w kodzie — port SynthPresets.kt.
// Częstotliwość próbkowania jest parametrem (natywna częstotliwość AudioContext),
// pętle mają dokładnie 1 takt (2 s) przy bazowym tempie 120 BPM.

export const BASE_BPM = 120;

/** Deterministyczny generator (mulberry32) — odpowiednik Random(1234) z Kotlina. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- narzędzia ----------

function normalize(data, peak) {
  let m = 0;
  for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
  return data;
}

/** Miksuje src do dst od offset; ogon zawija się na początek (płynna pętla). */
function mixInto(dst, src, offset, gain) {
  const n = dst.length;
  for (let i = 0; i < src.length; i++) dst[(offset + i) % n] += src[i] * gain;
}

/** Przeskalowanie wejściowego okna: normalizacja + krótki fade-out na końcu (bez kliknięcia). */
function makeFinish(sr) {
  return (data, peak) => {
    const fade = Math.min(Math.floor(sr * 0.005), data.length);
    for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade;
    return normalize(data, peak);
  };
}

/** Usuwa DC, daje krótkie fade'y na brzegach i normalizuje do ok. 0.9 (SampleProcessing.finish). */
export function finishSample(data, sr) {
  const n = data.length;
  if (n === 0) return data;

  let sum = 0;
  for (let i = 0; i < n; i++) sum += data[i];
  const mean = sum / n;
  for (let i = 0; i < n; i++) data[i] -= mean;

  const fade = Math.min(Math.floor(sr * 0.003), n >> 1);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    data[i] *= g;
    data[n - 1 - i] *= g;
  }

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak > 0.02) {
    const k = 0.9 / peak;
    for (let i = 0; i < n; i++) data[i] *= k;
  }
  return data;
}

// ---------- presety ----------

/**
 * @param {number} sr  częstotliwość próbkowania
 * @returns {{id:number,label:string,data:Float32Array,loop:boolean,color:string}[]}
 */
export function buildPads(sr) {
  const rng = makeRng(1234);
  const noise = () => rng() * 2 - 1;
  const finish = makeFinish(sr);
  const TWO_PI = 2 * Math.PI;

  const BAR = Math.round((sr * 60.0) / BASE_BPM * 4);
  const BEAT = Math.floor(BAR / 4);
  const EIGHTH = Math.floor(BAR / 8);

  // ----- one-shoty -----

  function kick() {
    const n = Math.floor(sr * 0.45);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const freq = 45 + 110 * Math.exp(-t * 28);
      phase += (TWO_PI * freq) / sr;
      out[i] = Math.sin(phase) * Math.exp(-t * 7);
    }
    return finish(out, 0.9);
  }

  function snare() {
    const n = Math.floor(sr * 0.25);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const tone = Math.sin(TWO_PI * 185 * t) * Math.exp(-t * 28) * 0.7;
      const nz = noise() * Math.exp(-t * 18) * 0.8;
      out[i] = tone + nz;
    }
    return finish(out, 0.85);
  }

  function hat(seconds, decay) {
    const n = Math.floor(sr * seconds);
    const out = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const x = noise();
      const hp = x - prev; // prosty filtr górnoprzepustowy
      prev = x;
      out[i] = hp * Math.exp(-t * decay);
    }
    return finish(out, 0.6);
  }

  function clap() {
    const n = Math.floor(sr * 0.25);
    const out = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = t < 0.03 ? Math.exp(-(t % 0.01) * 400) : Math.exp(-(t - 0.03) * 25);
      const x = noise();
      const y = x - 0.5 * prev;
      prev = x;
      out[i] = y * env;
    }
    return finish(out, 0.8);
  }

  function tom() {
    const n = Math.floor(sr * 0.4);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const freq = 100 + 120 * Math.exp(-t * 20);
      phase += (TWO_PI * freq) / sr;
      out[i] = Math.sin(phase) * Math.exp(-t * 8);
    }
    return finish(out, 0.85);
  }

  function cowbell() {
    const n = Math.floor(sr * 0.35);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const a = Math.sin(TWO_PI * 540 * t) >= 0 ? 1 : -1;
      const b = Math.sin(TWO_PI * 810 * t) >= 0 ? 1 : -1;
      const env = Math.exp(-t * 11) * Math.min(1, i / (sr * 0.001));
      out[i] = (0.6 * a + 0.4 * b) * env;
    }
    return finish(out, 0.55);
  }

  // ----- pętle (1 takt) -----

  function beatLoop(kickS, snareS, hatS) {
    const out = new Float32Array(BAR);
    for (let b = 0; b < 4; b++) {
      if (b % 2 === 0) mixInto(out, kickS, b * BEAT, 1);
      else mixInto(out, snareS, b * BEAT, 0.8);
    }
    mixInto(out, kickS, 5 * EIGHTH, 0.7);
    for (let e = 0; e < 8; e++) mixInto(out, hatS, e * EIGHTH, e % 2 === 1 ? 0.5 : 0.3);
    return normalize(out, 0.8);
  }

  /** Four-on-the-floor: kick co ćwierćnutę, clap na 2 i 4, open hat na offbeatach. */
  function houseLoop(kickS, clapS, openHatS) {
    const out = new Float32Array(BAR);
    for (let b = 0; b < 4; b++) mixInto(out, kickS, b * BEAT, 1);
    for (const b of [1, 3]) mixInto(out, clapS, b * BEAT, 0.7);
    for (const e of [1, 3, 5, 7]) mixInto(out, openHatS, e * EIGHTH, 0.4);
    return normalize(out, 0.8);
  }

  function hats16Loop(hatS) {
    const out = new Float32Array(BAR);
    for (let k = 0; k < 16; k++) {
      const g = k % 4 === 0 ? 0.35 : k % 4 === 2 ? 0.7 : 0.25;
      mixInto(out, hatS, Math.floor((k * BAR) / 16), g);
    }
    return normalize(out, 0.7);
  }

  function bassLoop() {
    const out = new Float32Array(BAR);
    const notes = [55.0, 55.0, 82.41, 55.0, 65.41, 55.0, 73.42, 82.41];
    notes.forEach((f, idx) => {
      const start = idx * EIGHTH;
      let phase = 0;
      for (let i = 0; i < EIGHTH; i++) {
        const t = i / sr;
        phase += (TWO_PI * f) / sr;
        const tone = Math.sin(phase) + 0.4 * Math.sin(2 * phase) + 0.2 * Math.sin(3 * phase);
        const attack = Math.min(1, i / (sr * 0.004));
        const release = Math.min(1, (EIGHTH - i) / (sr * 0.01));
        out[start + i] = tone * Math.exp(-t * 5) * attack * release;
      }
    });
    return normalize(out, 0.8);
  }

  /** Arpeggio 16-tych: Am przez pół taktu, potem F. */
  function arpLoop() {
    const out = new Float32Array(BAR);
    const notes = [
      220.0, 261.63, 329.63, 440.0, 329.63, 261.63, 220.0, 261.63,
      174.61, 220.0, 261.63, 349.23, 261.63, 220.0, 174.61, 220.0,
    ];
    notes.forEach((f, k) => {
      const start = Math.floor((k * BAR) / 16);
      const len = Math.floor(((k + 1) * BAR) / 16) - start;
      let phase = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        phase += (TWO_PI * f) / sr;
        let tone = 0;
        for (let h = 1; h <= 6; h++) tone += Math.sin(phase * h) / h; // przybliżona piła
        const attack = Math.min(1, i / (sr * 0.002));
        const release = Math.min(1, (len - i) / (sr * 0.01));
        out[start + i] = tone * Math.exp(-t * 14) * attack * release;
      }
    });
    return normalize(out, 0.7);
  }

  /**
   * Akord Am (A2, A3, C4, E4) z lekkim detune. Częstotliwości dobrane tak, żeby w 2 s
   * mieściła się całkowita liczba okresów, więc pętla jest bez kliknięcia.
   */
  function chordLoop() {
    const out = new Float32Array(BAR);
    const freqs = [110.0, 220.0, 261.5, 329.5];
    const detunes = [0.0, 0.5];
    const seconds = BAR / sr;
    for (let i = 0; i < BAR; i++) {
      const t = i / sr;
      let s = 0;
      for (const f0 of freqs) {
        for (const d of detunes) {
          const w = TWO_PI * (f0 + d) * t;
          s += Math.sin(w) + 0.3 * Math.sin(2 * w) + 0.12 * Math.sin(3 * w);
        }
      }
      out[i] = s * (0.85 + 0.15 * Math.sin((TWO_PI * t) / seconds));
    }
    return normalize(out, 0.55);
  }

  function shakerLoop() {
    const hitLen = Math.floor(sr * 0.09);
    const hit = new Float32Array(hitLen);
    let prev = 0;
    for (let i = 0; i < hitLen; i++) {
      const t = i / sr;
      const x = noise();
      const hp = x - prev;
      prev = x;
      hit[i] = hp * (1 - Math.exp(-t * 900)) * Math.exp(-t * 38);
    }
    normalize(hit, 0.6);
    const out = new Float32Array(BAR);
    for (let k = 0; k < 16; k++) {
      const g = k % 4 === 0 ? 0.45 : k % 4 === 2 ? 0.6 : 0.3;
      mixInto(out, hit, Math.floor((k * BAR) / 16), g);
    }
    return normalize(out, 0.55);
  }


  // ----- dodatkowe presety: perkusja, bas, FX, syntezator -----

  function rim() {
    const n = Math.floor(sr * 0.1);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const tone = Math.sin(TWO_PI * 1700 * t) * 0.6 + Math.sin(TWO_PI * 820 * t) * 0.5;
      out[i] = tone * Math.exp(-t * 110) + noise() * Math.exp(-t * 200) * 0.4;
    }
    return finish(out, 0.7);
  }

  function crash() {
    const n = Math.floor(sr * 1.4);
    const out = new Float32Array(n);
    const ratios = [1.0, 1.4471, 1.6170, 1.9265, 2.5028, 2.6637];
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const x = noise();
      const hp = x - prev;
      prev = x;
      let metal = 0;
      for (const r of ratios) metal += Math.sin(TWO_PI * 3100 * r * t) > 0 ? 1 : -1;
      const env = Math.min(1, i / (sr * 0.002)) * Math.exp(-t * 3.2);
      out[i] = (hp * 0.8 + (metal / ratios.length) * 0.25) * env;
    }
    return finish(out, 0.6);
  }

  function sub808() {
    const n = Math.floor(sr * 0.9);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const freq = 46 + 90 * Math.exp(-t * 22);
      phase += (TWO_PI * freq) / sr;
      const click = Math.min(1, i / (sr * 0.002));
      out[i] = Math.tanh(Math.sin(phase) * 1.7) * Math.exp(-t * 2.6) * click;
    }
    return finish(out, 0.9);
  }

  function zap() {
    const n = Math.floor(sr * 0.3);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const freq = 200 + 2600 * Math.exp(-t * 14);
      phase += (TWO_PI * freq) / sr;
      out[i] = (Math.sin(phase) + 0.3 * Math.sin(phase * 2.01)) * Math.exp(-t * 9);
    }
    return finish(out, 0.6);
  }

  function stab() {
    const n = Math.floor(sr * 0.5);
    const out = new Float32Array(n);
    const notes = [220.0, 261.63, 329.63, 392.0]; // Am7
    for (const f of notes) {
      for (const det of [0.997, 1.003]) {
        let phase = 0;
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          phase += (TWO_PI * f * det) / sr;
          let tone = 0;
          for (let h = 1; h <= 6; h++) tone += Math.sin(phase * h) / h;
          out[i] += tone * Math.exp(-t * 9) * Math.min(1, i / (sr * 0.003));
        }
      }
    }
    return finish(out, 0.7);
  }

  function riser() {
    const n = Math.floor(sr * 1.6);
    const out = new Float32Array(n);
    let y = 0;
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const a = 0.02 + 0.6 * u * u;
      y += a * (noise() - y); // filtr dolnoprzepustowy z rosnącym przecięciem
      phase += (TWO_PI * (150 + 1500 * u * u)) / sr;
      out[i] = (y * 1.6 + 0.35 * Math.sin(phase)) * Math.pow(u, 1.5);
    }
    return finish(out, 0.7);
  }

  /** Funkowa perkusja, 16-tki. */
  function funkLoop(kickS, snareS, hatS) {
    const out = new Float32Array(BAR);
    const at = (k) => Math.floor((k * BAR) / 16);
    for (const k of [0, 5, 8, 10]) mixInto(out, kickS, at(k), k === 0 ? 1 : 0.8);
    for (const k of [4, 12]) mixInto(out, snareS, at(k), 0.85);
    for (const k of [7, 15]) mixInto(out, snareS, at(k), 0.25); // ghost notes
    for (let k = 0; k < 16; k++) mixInto(out, hatS, at(k), k % 2 === 0 ? 0.4 : 0.22);
    return normalize(out, 0.8);
  }

  /** Acid: 16 kroków, piła przez dwubiegunowy filtr z obwiednią. */
  function acidLoop() {
    const out = new Float32Array(BAR);
    const notes = [
      55.0, 55.0, 110.0, 55.0, 82.41, 55.0, 65.41, 98.0,
      55.0, 55.0, 110.0, 55.0, 73.42, 55.0, 82.41, 65.41,
    ];
    notes.forEach((f, k) => {
      const start = Math.floor((k * BAR) / 16);
      const len = Math.floor(((k + 1) * BAR) / 16) - start;
      let phase = 0;
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        phase += f / sr;
        const saw = 2 * (phase - Math.floor(phase)) - 1;
        const c = 0.03 + 0.45 * Math.exp(-t * 16);
        y1 += c * (saw - y1);
        y2 += c * (y1 - y2);
        const gate = Math.min(1, (len - i) / (sr * 0.008)) * Math.min(1, i / (sr * 0.002));
        out[start + i] = y2 * Math.exp(-t * 3) * gate;
      }
    });
    return normalize(out, 0.75);
  }

  /** Melodia na wibrującym „pulsie”, pentatonika a-moll. */
  function leadLoop() {
    const out = new Float32Array(BAR);
    const notes = [440.0, 523.25, 659.25, 523.25, 587.33, 440.0, 392.0, 440.0];
    notes.forEach((f, k) => {
      const start = k * EIGHTH;
      let phase = 0;
      for (let i = 0; i < EIGHTH; i++) {
        const t = i / sr;
        const vib = 1 + 0.004 * Math.sin(TWO_PI * 5.5 * t);
        phase += (TWO_PI * f * vib) / sr;
        let tone = 0;
        for (let h = 1; h <= 9; h += 2) tone += Math.sin(phase * h) / (h * h) * (h % 4 === 1 ? 1 : -1);
        const attack = Math.min(1, i / (sr * 0.004));
        const release = Math.min(1, (EIGHTH - i) / (sr * 0.012));
        out[start + i] = tone * Math.exp(-t * 5) * attack * release;
      }
    });
    return normalize(out, 0.6);
  }

  // ----- składanie -----

  const kickS = kick();
  const snareS = snare();
  const closedHat = hat(0.07, 60);
  const openHat = hat(0.35, 11);
  const clapS = clap();
  const tomS = tom();
  const cowbellS = cowbell();

  const beat = beatLoop(kickS, snareS, closedHat);
  const house = houseLoop(kickS, clapS, openHat);
  const bass = bassLoop();
  const hats16 = hats16Loop(closedHat);
  const arp = arpLoop();
  const chord = chordLoop();
  const shaker = shakerLoop();

  const rimS = rim();
  const crashS = crash();
  const sub = sub808();
  const zapS = zap();
  const stabS = stab();
  const riserS = riser();
  const funk = funkLoop(kickS, snareS, closedHat);
  const acid = acidLoop();
  const lead = leadLoop();

  // one-shoty (ciepłe kolory); pętle (zimne). Tryb można zmienić podwójnym kliknięciem.
  return [
    { id: 0, label: 'KICK', data: kickS, loop: false, color: '#FF5252' },
    { id: 1, label: 'SNARE', data: snareS, loop: false, color: '#FF9100' },
    { id: 2, label: 'HAT', data: closedHat, loop: false, color: '#FFD740' },
    { id: 3, label: 'OPEN HAT', data: openHat, loop: false, color: '#C6FF00' },
    { id: 4, label: 'CLAP', data: clapS, loop: false, color: '#FF4081' },
    { id: 5, label: 'TOM', data: tomS, loop: false, color: '#69F0AE' },
    { id: 6, label: 'COWBELL', data: cowbellS, loop: false, color: '#FF6E40' },
    { id: 7, label: 'BEAT', data: beat, loop: true, color: '#40C4FF' },
    { id: 8, label: 'HOUSE', data: house, loop: true, color: '#448AFF' },
    { id: 9, label: 'BASS', data: bass, loop: true, color: '#B388FF' },
    { id: 10, label: 'HATS 16', data: hats16, loop: true, color: '#EA80FC' },
    { id: 11, label: 'ARP', data: arp, loop: true, color: '#18FFFF' },
    { id: 12, label: 'CHORD', data: chord, loop: true, color: '#64FFDA' },
    { id: 13, label: 'SHAKER', data: shaker, loop: true, color: '#80D8FF' },
    // --- rozszerzenie: perkusja, bas, FX, syntezator ---
    { id: 14, label: 'RIM', data: rimS, loop: false, color: '#FFAB91' },
    { id: 15, label: 'CRASH', data: crashS, loop: false, color: '#F4FF81' },
    { id: 16, label: '808', data: sub, loop: false, color: '#FF8A80' },
    { id: 17, label: 'ZAP', data: zapS, loop: false, color: '#84FFFF' },
    { id: 18, label: 'STAB', data: stabS, loop: false, color: '#CCFF90' },
    { id: 19, label: 'RISER', data: riserS, loop: false, color: '#B9F6CA' },
    { id: 20, label: 'FUNK', data: funk, loop: true, color: '#82B1FF' },
    { id: 21, label: 'ACID', data: acid, loop: true, color: '#CE93D8' },
    { id: 22, label: 'LEAD', data: lead, loop: true, color: '#A7FFEB' },
  ];
}
