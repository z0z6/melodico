// Intro — port Intro.kt: wirująca neonowa płyta, pulsujące pierścienie, equalizer i tytuł z poświatą.
// W wersji webowej AudioContext można uruchomić dopiero po geście użytkownika, więc po animacji
// (ok. 3,2 s) ekran czeka na dotknięcie / kliknięcie / dowolny klawisz.

import { U, canvasView, circle, rgba, roundRect } from './ui.js';

const NEON_CYAN = '#00E5FF';
const NEON_MAGENTA = '#FF2D95';
const NEON_VIOLET = '#7C4DFF';
const DURATION_MS = 3200;
const DEG = Math.PI / 180;

const phase = (p, from, to) => Math.min(1, Math.max(0, (p - from) / (to - from)));
const ease = (x) => 1 - (1 - x) * (1 - x) * (1 - x);

function lerpHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
}

/**
 * @param {HTMLElement} root  element #intro
 * @param {() => void} onStart wołane synchronicznie z gestu użytkownika
 */
export function createIntro(root, onStart) {
  const canvasEl = root.querySelector('#introCanvas');
  const nameEl = root.querySelector('#introName');
  const barEl = root.querySelector('#introBar');
  const tagEl = root.querySelector('#introTag');
  const startEl = root.querySelector('#introStart');

  let p = 0;
  let started = false;
  let running = true;
  let t0 = performance.now();

  // Canvas z #introCanvas obsługujemy ręcznie (canvasView tworzy własny element, więc go podmieniamy).
  const view = canvasView((ctx, w, h) => draw(ctx, w, h), '');
  view.canvas.id = 'introCanvas';
  canvasEl.replaceWith(view.canvas);

  function draw(ctx, w, h) {
    const portrait = h > w;
    const appear = ease(phase(p, 0, 0.22));

    // tło i neonowe poświaty
    let g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0B0D17');
    g.addColorStop(1, '#040508');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const gA = 0.3 * appear;
    const rad = Math.max(w, h * (portrait ? 0.6 : 1)) * 0.4;
    const glow = (x, y, color) => {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, rgba(color, gA));
      rg.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = rg;
      circle(ctx, x, y, rad);
      ctx.fill();
    };
    glow(w * 0.22, h * 0.3, NEON_CYAN);
    glow(w * 0.85, h * 0.8, NEON_MAGENTA);

    // płyta (po lewej; w pionie na górze, na środku)
    const cx = portrait ? w * 0.5 : w * 0.27;
    const cy = portrait ? h * 0.28 : h * 0.45;
    const base = portrait ? Math.min(w * 0.3, h * 0.2) : Math.min(w * 0.19, h * 0.33);
    const r = base * (0.7 + 0.3 * appear);
    const spin = p * 900 * DEG;

    for (let k = 0; k < 3; k++) {
      const t = (p * 3.2 + k / 3) % 1;
      ctx.strokeStyle = rgba(NEON_CYAN, (1 - t) * 0.3 * appear);
      ctx.lineWidth = 2 * U;
      circle(ctx, cx, cy, r * (1 + 0.9 * t));
      ctx.stroke();
    }

    ctx.globalAlpha = appear;
    ctx.fillStyle = '#0A0B10';
    circle(ctx, cx, cy, r);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.lineWidth = 1;
    for (let i = 1; i <= 6; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.05 * appear})`;
      circle(ctx, cx, cy, r * (0.38 + 0.09 * i));
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    ctx.globalAlpha = appear;
    if (ctx.createConicGradient) {
      const cg = ctx.createConicGradient(0, 0, 0);
      cg.addColorStop(0, NEON_CYAN);
      cg.addColorStop(0.5, NEON_MAGENTA);
      cg.addColorStop(1, NEON_CYAN);
      ctx.strokeStyle = cg;
    } else {
      ctx.strokeStyle = NEON_CYAN;
    }
    ctx.lineWidth = r * 0.045;
    circle(ctx, 0, 0, r);
    ctx.stroke();

    g = ctx.createLinearGradient(-r * 0.3, -r * 0.3, r * 0.3, r * 0.3);
    g.addColorStop(0, NEON_MAGENTA);
    g.addColorStop(1, NEON_VIOLET);
    ctx.fillStyle = g;
    circle(ctx, 0, 0, r * 0.3);
    ctx.fill();

    ctx.strokeStyle = `rgba(255,255,255,${0.9 * appear})`;
    ctx.lineWidth = r * 0.035;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.1);
    ctx.lineTo(0, -r * 0.26);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#0A0B10';
    circle(ctx, cx, cy, r * 0.035);
    ctx.fill();

    if (ctx.createConicGradient) {
      const cg = ctx.createConicGradient(0, cx, cy);
      const clear = 'rgba(255,255,255,0)';
      const shine = `rgba(255,255,255,${0.12 * appear})`;
      cg.addColorStop(0, clear);
      cg.addColorStop(0.07, shine);
      cg.addColorStop(0.14, clear);
      cg.addColorStop(0.5, clear);
      cg.addColorStop(0.57, shine);
      cg.addColorStop(0.64, clear);
      cg.addColorStop(1, clear);
      ctx.fillStyle = cg;
      circle(ctx, cx, cy, r * 0.97);
      ctx.fill();
    }

    // equalizer na dole
    const n = 32;
    const bw = (w * 0.9) / n;
    const gap = bw * 0.35;
    const baseY = h * 0.97;
    const maxH = h * 0.2;
    for (let i = 0; i < n; i++) {
      const m = Math.abs(Math.sin(p * 14 + i * 0.6)) * (0.5 + 0.5 * Math.abs(Math.cos(p * 9 + i * 0.31)));
      const bh = maxH * (0.08 + 0.92 * m) * appear;
      const [rr, gg, bb] = lerpHex(NEON_CYAN, NEON_MAGENTA, i / (n - 1));
      ctx.fillStyle = `rgba(${rr},${gg},${bb},0.85)`;
      roundRect(ctx, w * 0.05 + i * bw, baseY - bh, bw - gap, bh, bw * 0.3);
      ctx.fill();
    }
  }

  function updateText() {
    const title = ease(phase(p, 0.2, 0.52));
    const tagline = ease(phase(p, 0.48, 0.7));
    nameEl.style.opacity = String(title);
    nameEl.style.letterSpacing = (26 - 20 * title) * U + 'px';
    nameEl.style.textShadow = `0 0 ${14 * U}px rgba(0,229,255,${0.85 * title})`;
    barEl.style.width = 85 * title + '%';
    tagEl.style.opacity = String(tagline);
    if (p > 0.75 && !startEl.classList.contains('blink') && !started) startEl.classList.add('blink');
  }

  function frame(now) {
    if (!running) return;
    p = (now - t0) / DURATION_MS;
    updateText();
    view.redraw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function trigger(e) {
    if (started) return;
    if (e && e.type === 'keydown' && (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab')) return;
    started = true;
    startEl.classList.remove('blink');
    startEl.style.opacity = '1';
    startEl.textContent = 'STARTING…';
    onStart();
  }
  root.addEventListener('click', trigger); // click = „activation triggering” także dla dotyku (iOS)
  window.addEventListener('keydown', trigger);

  return {
    /** Błąd startu: pozwala spróbować ponownie. */
    fail(message) {
      started = false;
      startEl.textContent = message;
      startEl.style.opacity = '1';
    },
    destroy() {
      running = false;
      window.removeEventListener('keydown', trigger);
      root.removeEventListener('click', trigger);
      root.classList.add('gone');
      setTimeout(() => root.remove(), 600);
    },
  };
}
