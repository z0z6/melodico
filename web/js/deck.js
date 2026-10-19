// Deck winylowy — port Deck.kt. Płyta obraca się zgodnie z pozycją w tracku. Dotknięcie płyty
// ją zatrzymuje, a przesuwanie palca (myszy) po okręgu to scratch (do przodu i do tyłu).
// Puszczenie = powrót do obrotów silnika.

import {
  ConsoleButton,
  ConsoleColors,
  HFader,
  U,
  canvasView,
  circle,
  h,
  rgba,
} from './ui.js';

// położenie i rozmiar talerza w kwadratowym canvasie (tonearm ma miejsce w prawym górnym rogu)
const PLATTER_CX = 0.45;
const PLATTER_CY = 0.53;
const PLATTER_R = 0.42;
const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

function fmtTime(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * @param {import('./engine.js').Engine} engine
 * @param {{ onLoad: () => void }} opts
 */
export function createDeck(engine, { onLoad }) {
  const accent = ConsoleColors.Cyan;

  // ---- nagłówek
  const nameEl = h('div', 'dname', { text: 'NO TRACK' });
  const timeEl = h('div', 'dtime', { text: '0:00 / 0:00' });
  const head = h('div', 'deck-head', null, h('div', 'dtitle', { text: 'DECK A' }), nameEl, timeEl);

  // ---- talerz
  let lower = 0; // 0 = ramię w spoczynku, 1 = opuszczone (animowane)
  let lastKey = '';

  const view = canvasView((ctx, w, hh) => draw(ctx, w, hh));
  const canvas = view.canvas;
  const hint = h('div', 'platter-hint', { text: 'LOAD A TRACK' });
  const wrap = h('div', 'platter-wrap', null, canvas, hint);

  // kwadratowy canvas o boku min(szerokość, wysokość) kontenera
  function fit() {
    const r = wrap.getBoundingClientRect();
    const s = Math.floor(Math.min(r.width, r.height));
    if (s > 0) {
      canvas.style.width = s + 'px';
      canvas.style.height = s + 'px';
    }
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(wrap);

  function draw(ctx, w, hh) {
    const d = engine.deck;
    const pos = d.pos;
    const len = d.len;
    const s = Math.min(w, hh);
    const cx = w * PLATTER_CX;
    const cy = hh * PLATTER_CY;
    const r = s * PLATTER_R;
    const angle = (((pos / engine.framesPerRev) * 360) % 360) * DEG;
    const prog = len > 0 ? Math.min(1, Math.max(0, pos / len)) : 0;

    // cień i talerz
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    circle(ctx, cx, cy + 3 * U, r * 1.06);
    ctx.fill();
    let g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    g.addColorStop(0, '#3A3F4A');
    g.addColorStop(1, '#1A1C21');
    ctx.fillStyle = g;
    circle(ctx, cx, cy, r * 1.03);
    ctx.fill();

    // znaczniki strobo na obrzeżu, obracają się razem z płytą
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.lineWidth = 1.2 * U;
    for (let i = 0; i < 72; i++) {
      const a = (i * TWO_PI) / 72;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const major = i % 6 === 0;
      ctx.strokeStyle = `rgba(138,147,163,${major ? 0.9 : 0.45})`;
      ctx.beginPath();
      ctx.moveTo(ca * r * (major ? 0.955 : 0.97), sa * r * (major ? 0.955 : 0.97));
      ctx.lineTo(ca * r * 1.01, sa * r * 1.01);
      ctx.stroke();
    }
    ctx.restore();

    // płyta i rowki
    ctx.fillStyle = '#08090C';
    circle(ctx, cx, cy, r * 0.94);
    ctx.fill();
    ctx.lineWidth = 1;
    for (let i = 0; i <= 11; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${i % 4 === 0 ? 0.1 : 0.04})`;
      circle(ctx, cx, cy, r * (0.4 + 0.045 * i));
      ctx.stroke();
    }

    // neonowa krawędź (mocniej, gdy gra)
    const glowA = 0.25 + 0.55 * lower;
    ctx.strokeStyle = rgba(accent, glowA * 0.35);
    ctx.lineWidth = 5 * U;
    circle(ctx, cx, cy, r * 0.945);
    ctx.stroke();
    ctx.strokeStyle = rgba(accent, glowA);
    ctx.lineWidth = 1.5 * U;
    circle(ctx, cx, cy, r * 0.945);
    ctx.stroke();

    // etykieta (obraca się)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    g = ctx.createLinearGradient(-r * 0.3, -r * 0.3, r * 0.3, r * 0.3);
    g.addColorStop(0, '#FF2D95');
    g.addColorStop(1, '#7C4DFF');
    ctx.fillStyle = g;
    circle(ctx, 0, 0, r * 0.31);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = r * 0.03;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, -105 * DEG, -60 * DEG);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    circle(ctx, 0, -r * 0.27, r * 0.025);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#08090C';
    circle(ctx, cx, cy, r * 0.04);
    ctx.fill();

    // połysk (nieruchomy)
    if (ctx.createConicGradient) {
      const cg = ctx.createConicGradient(0, cx, cy);
      const clear = 'rgba(255,255,255,0)';
      const shine = 'rgba(255,255,255,0.11)';
      cg.addColorStop(0, clear);
      cg.addColorStop(0.07, shine);
      cg.addColorStop(0.14, clear);
      cg.addColorStop(0.5, clear);
      cg.addColorStop(0.57, shine);
      cg.addColorStop(0.64, clear);
      cg.addColorStop(1, clear);
      ctx.fillStyle = cg;
      circle(ctx, cx, cy, r * 0.94);
      ctx.fill();
    }

    // ramię: spoczynek -> opuszczone, przesuwa się do środka wraz z postępem tracka
    const pvx = w * 0.93;
    const pvy = hh * 0.1;
    const armLen = s * 0.66;
    const a0 = 80;
    const a1 = 105 + 20 * prog;
    const ang = (a0 + (a1 - a0) * lower) * DEG;
    const tx = pvx + armLen * Math.cos(ang);
    const ty = pvy + armLen * Math.sin(ang);
    const shx = 2 * U;
    const shy = 3 * U;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3 * U;
    ctx.beginPath();
    ctx.moveTo(pvx + shx, pvy + shy);
    ctx.lineTo(tx + shx, ty + shy);
    ctx.stroke();
    ctx.strokeStyle = '#C7CCD6';
    ctx.lineWidth = 2.5 * U;
    ctx.beginPath();
    ctx.moveTo(pvx, pvy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.fillStyle = '#FF9100';
    circle(ctx, tx, ty, 3.5 * U);
    ctx.fill();
    ctx.fillStyle = '#2A2D34';
    circle(ctx, pvx, pvy, 9 * U);
    ctx.fill();
    ctx.fillStyle = '#8A93A3';
    circle(ctx, pvx, pvy, 4 * U);
    ctx.fill();
  }

  // ---- scratch: obrót płyty = ruch po okręgu
  let scratching = null; // { id, last }
  canvas.addEventListener('pointerdown', (e) => {
    if (engine.deck.status !== 'ready' || scratching) return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width * PLATTER_CX;
    const cy = rect.top + rect.height * PLATTER_CY;
    const radius = Math.min(rect.width, rect.height) * PLATTER_R;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    if (Math.hypot(dx, dy) > radius * 1.05) return;

    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    scratching = { id: e.pointerId, last: Math.atan2(dy, dx) };
    canvas.style.cursor = 'grabbing';
    engine.deckTouch(true);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!scratching || e.pointerId !== scratching.id) return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width * PLATTER_CX;
    const cy = rect.top + rect.height * PLATTER_CY;
    const a = Math.atan2(e.clientY - cy, e.clientX - cx);
    let d = a - scratching.last;
    if (d > Math.PI) d -= TWO_PI;
    else if (d < -Math.PI) d += TWO_PI;
    engine.deckScratch(d / TWO_PI);
    scratching.last = a;
  });
  const endScratch = (e) => {
    if (!scratching || e.pointerId !== scratching.id) return;
    scratching = null;
    canvas.style.cursor = '';
    engine.deckTouch(false);
  };
  canvas.addEventListener('pointerup', endScratch);
  canvas.addEventListener('pointercancel', endScratch);
  canvas.addEventListener('lostpointercapture', endScratch);

  // ---- przyciski transportu
  const bLoad = ConsoleButton('LOAD', ConsoleColors.Amber, () => onLoad());
  const bPlay = ConsoleButton('PLAY', ConsoleColors.Green, () => engine.deckTogglePlay());
  const bCue = ConsoleButton('CUE', accent, () => engine.deckCue());
  const bLoop = ConsoleButton('LOOP', ConsoleColors.Green, () => engine.deckToggleLoop());
  const transport = h('div', 'transport', null, bLoad.el, bPlay.el, bCue.el, bLoop.el);

  // ---- fadery
  const fmtPitch = (v) => {
    const pct = (v - 0.5) * 2 * 16;
    return (pct >= 0 ? '+' : '-') + Math.abs(pct).toFixed(1) + '%';
  };
  let pitchV = 0.5;
  let volV = 0.8;
  const pitch = HFader({
    label: 'PITCH',
    value: 0.5,
    color: ConsoleColors.Amber,
    centerDetent: true,
    readout: fmtPitch,
    onChange: (v) => {
      pitchV = v;
      engine.deckSetPitch((v - 0.5) * 2 * 16);
    },
  });
  const vol = HFader({
    label: 'VOL',
    value: 0.8,
    color: accent,
    readout: (v) => `${Math.floor(v * 100)}%`,
    onChange: (v) => {
      volV = v;
      engine.deckSetVolume(v);
    },
  });

  const el = h('div', 'deck panel', null, head, wrap, transport, pitch.el, vol.el);

  // ---- odświeżanie co klatkę
  let last = performance.now();
  return {
    el,
    /** Wołane z pętli requestAnimationFrame. */
    tick(now) {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const d = engine.deck;

      // ramię: animacja opuszczania/podnoszenia (ok. 450 ms)
      const target = d.playing ? 1 : 0;
      if (lower !== target) {
        const step = dt / 0.45;
        lower = lower < target ? Math.min(target, lower + step) : Math.max(target, lower - step);
      }

      // teksty
      const sr = engine.sr;
      const cur = Math.floor(d.pos / sr);
      const name = d.name || 'NO TRACK';
      const time = fmtTime(cur) + ' / ' + fmtTime(Math.floor(d.len / sr));
      if (nameEl.textContent !== name) nameEl.textContent = name;
      if (timeEl.textContent !== time) timeEl.textContent = time;
      bPlay.setText(d.playing ? 'PAUSE' : 'PLAY');
      bPlay.setLit(d.playing);
      bLoop.setLit(d.loop);
      bLoad.setLit(d.status === 'loading');
      const ready = d.status === 'ready';
      hint.style.display = ready ? 'none' : '';
      hint.textContent = d.status === 'loading' ? 'LOADING TRACK...' : 'LOAD A TRACK';

      // płyta: przerysowujemy tylko przy zmianie
      const key = `${d.pos.toFixed(0)}|${lower.toFixed(3)}|${d.len}`;
      if (key !== lastKey) {
        lastKey = key;
        view.redraw();
      }
    },
    redraw() {
      lastKey = '';
      view.redraw();
    },
    togglePlay() {
      engine.deckTogglePlay();
    },
    /** Stan zapisywany w banku. */
    getState() {
      return { pitch: pitchV, vol: volV, loop: engine.deck.loop };
    },
    setState(st) {
      if (!st) return;
      pitchV = st.pitch ?? 0.5;
      volV = st.vol ?? 0.8;
      pitch.set(pitchV);
      vol.set(volV);
      engine.deckSetPitch((pitchV - 0.5) * 2 * 16);
      engine.deckSetVolume(volV);
      if (!!st.loop !== engine.deck.loop) engine.deckToggleLoop();
    },
  };
}
