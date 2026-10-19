// Wspólne narzędzia UI i widgety w stylu konsolety (port ConsoleStyle.kt, Knob.kt, Fader.kt).

export const ConsoleColors = {
  Label: '#9AA3B2',
  Red: '#FF1744',
  Green: '#00E676',
  Amber: '#FFC400',
  Cyan: '#00E5FF',
};

// ---------------------------------------------------------------- jednostka „dp”

/** Rozmiar jednego „dp” w pikselach CSS (ustawiany zależnie od rozmiaru okna). */
export let U = 1;

function computeUnit() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // poziomo: projekt 800x360 dp; pionowo: projekt o szerokości 300 dp
  const u = w >= h ? Math.min(w / 800, h / 360) : w / 300;
  return Math.min(4, Math.max(0.5, u));
}

export function updateUnit() {
  U = computeUnit();
  document.documentElement.style.setProperty('--u', U + 'px');
}

// ----------------------------------------------------------------------- DOM

/** Mały helper do tworzenia elementów. */
export function h(tag, cls, props, ...children) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') el.textContent = v;
      else if (k === 'style') Object.assign(el.style, v);
      else el.setAttribute(k, v);
    }
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

/** Canvas dopasowany do rozmiaru elementu (z uwzględnieniem DPR); `draw(ctx, w, h)` w pikselach CSS. */
export function canvasView(draw, cls) {
  const canvas = h('canvas', cls);
  const ctx = canvas.getContext('2d');
  let w = 0;
  let hh = 0;
  let dpr = 1;

  function redraw() {
    if (w <= 0 || hh <= 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    draw(ctx, w, hh);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    w = r.width;
    hh = r.height;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(hh * dpr));
    redraw();
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);

  return {
    canvas,
    redraw,
    get width() {
      return w;
    },
    get height() {
      return hh;
    },
  };
}

export function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
}

export function roundRect(ctx, x, y, w, hh, r) {
  r = Math.max(0, Math.min(r, w / 2, hh / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hh, r);
  ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// -------------------------------------------------------------------- toast

let toastTimer = 0;
export function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ------------------------------------------------------------ ConsoleButton

/** Mały przycisk konsoli z diodą LED u góry. */
export function ConsoleButton(text, ledColor, onClick, { lit = false } = {}) {
  const el = h('button', 'cbtn' + (lit ? ' lit' : ''), { type: 'button', tabindex: '-1', text });
  el.style.setProperty('--led', ledColor);
  el.addEventListener('click', (e) => {
    onClick(e);
    el.blur();
  });
  return {
    el,
    setLit(v) {
      el.classList.toggle('lit', !!v);
    },
    setText(t) {
      if (el.textContent !== t) el.textContent = t;
    },
  };
}

// --------------------------------------------------------------- LevelMeter

/** Segmentowy wskaźnik wysterowania (zielony / żółty / czerwony). */
export function LevelMeter() {
  let level = 0;
  const view = canvasView((ctx, w, hh) => {
    const n = 18;
    const gap = 2 * U;
    const segW = (w - gap * (n - 1)) / n;
    const lit = Math.floor(Math.sqrt(Math.min(1, Math.max(0, level))) * n);
    for (let i = 0; i < n; i++) {
      const c = i >= 15 ? ConsoleColors.Red : i >= 11 ? ConsoleColors.Amber : ConsoleColors.Green;
      ctx.fillStyle = i < lit ? c : rgba(c, 0.14);
      roundRect(ctx, i * (segW + gap), 0, segW, hh, 1.5 * U);
      ctx.fill();
    }
  });
  const el = h('div', 'meter');
  el.append(view.canvas);
  let lastLit = -1;
  return {
    el,
    /** Wołane co klatkę z ostatnim szczytem. */
    tick(peak) {
      level = peak > level ? peak : level * 0.88;
      const lit = Math.floor(Math.sqrt(Math.min(1, level)) * 18);
      if (lit !== lastLit) {
        lastLit = lit;
        view.redraw();
      }
    },
  };
}

// -------------------------------------------------------------------- Knob

/**
 * Obrotowe pokrętło: przeciągnięcie w górę lub w prawo zwiększa wartość, w dół lub w lewo zmniejsza.
 * Podwójne dotknięcie przywraca wartość domyślną. Kółko myszy też działa.
 */
export function KnobDial({ value, min, max, def, step, color, onChange }) {
  let cur = value;

  const view = canvasView((ctx, w, hh) => {
    const frac = Math.min(1, Math.max(0, (cur - min) / (max - min)));
    const s = Math.min(w, hh);
    const ringW = s * 0.09;
    const cx = w / 2;
    const cy = hh / 2;
    const arcR = (s - ringW) / 2;
    const start = (135 * Math.PI) / 180;
    const sweep = (270 * Math.PI) / 180;

    ctx.fillStyle = '#0B0C0F';
    circle(ctx, cx, cy, s / 2);
    ctx.fill();

    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2A2D34';
    ctx.lineWidth = ringW;
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, start, start + sweep);
    ctx.stroke();

    if (frac > 0) {
      ctx.strokeStyle = rgba(color, 0.25);
      ctx.lineWidth = ringW * 1.9;
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, start, start + sweep * frac);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = ringW;
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, start, start + sweep * frac);
      ctx.stroke();
    }

    // trzon pokrętła
    const g = ctx.createLinearGradient(0, cy - s * 0.33, 0, cy + s * 0.33);
    g.addColorStop(0, '#50555F');
    g.addColorStop(1, '#22252B');
    ctx.fillStyle = g;
    circle(ctx, cx, cy, s * 0.33);
    ctx.fill();

    const ang = start + sweep * frac;
    const r1 = s * 0.12;
    const r2 = s * 0.3;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = s * 0.06;
    ctx.beginPath();
    ctx.moveTo(cx + r1 * Math.cos(ang), cy + r1 * Math.sin(ang));
    ctx.lineTo(cx + r2 * Math.cos(ang), cy + r2 * Math.sin(ang));
    ctx.stroke();
  });

  const canvas = view.canvas;
  let dragging = false;
  let acc = 0;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let downT = 0;
  let moved = false;
  let lastTap = null; // { t, x, y } — ostatnie „czyste” dotknięcie (bez przeciągania)

  function apply(v) {
    if (v !== cur) onChange(v);
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const now = performance.now();
    if (
      lastTap &&
      now - lastTap.t < 300 &&
      Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 12 * U
    ) {
      lastTap = null;
      dragging = false;
      apply(def); // podwójne dotknięcie (dwa tapy) = reset
      return;
    }
    downX = e.clientX;
    downY = e.clientY;
    downT = now;
    moved = false;
    dragging = true;
    acc = cur;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 * U) moved = true;
    const delta = ((dx - dy) / (220 * U)) * (max - min);
    acc = Math.min(max, Math.max(min, acc + delta));
    const stepped = Math.min(max, Math.max(min, Math.round(acc / step) * step));
    apply(stepped);
  });

  const end = (e) => {
    if (dragging && !moved && e.type === 'pointerup') lastTap = { t: downT, x: downX, y: downY };
    else lastTap = null;
    dragging = false;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      apply(Math.min(max, Math.max(min, cur + dir * step)));
    },
    { passive: false }
  );

  return {
    canvas,
    set(v) {
      cur = v;
      view.redraw();
    },
  };
}

/** Pokrętło z podpisem i cyfrowym odczytem obok, do wąskiego paska. */
export function CompactKnob({ label, value, min, max, def, step, readout, color, onChange, small = false }) {
  const read = h('div', 'kread', { text: readout(value) });
  read.style.color = color;
  const dial = KnobDial({
    value,
    min,
    max,
    def,
    step,
    color,
    onChange: (v) => {
      dial.set(v);
      read.textContent = readout(v);
      onChange(v);
    },
  });
  const el = h(
    'div',
    'knob' + (small ? ' small' : ''),
    null,
    dial.canvas,
    h('div', 'ktext', null, h('div', 'klabel', { text: label }), read)
  );
  return {
    el,
    /** Ustawia wartość bez wywoływania onChange (np. przy wczytaniu banku). */
    setValue(v) {
      dial.set(v);
      read.textContent = readout(v);
    },
  };
}

// ------------------------------------------------------------------- Fader

/** Poziomy suwak w stylu konsolety. Wartość 0..1; `centerDetent` łapie środek (np. pitch). */
export function HFader({ label, value, color, readout, centerDetent = false, onChange }) {
  let cur = value;
  const read = h('div', 'fread', { text: readout(value) });
  read.style.color = color;

  const view = canvasView((ctx, w, hh) => {
    const half = 5 * U;
    const trackH = 5 * U;
    const trackTop = (hh - trackH) / 2;
    const x = half + (w - 2 * half) * Math.min(1, Math.max(0, cur));

    ctx.fillStyle = '#050607';
    roundRect(ctx, 0, trackTop, w, trackH, trackH / 2);
    ctx.fill();

    // wypełnienie: od lewej (lub od środka dla detentu)
    const from = centerDetent ? w / 2 : 0;
    const left = Math.min(from, x);
    const right = Math.max(from, x);
    ctx.fillStyle = rgba(color, 0.85);
    roundRect(ctx, left, trackTop, right - left, trackH, trackH / 2);
    ctx.fill();

    if (centerDetent) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = U;
      ctx.beginPath();
      ctx.moveTo(w / 2, trackTop - 3 * U);
      ctx.lineTo(w / 2, trackTop + trackH + 3 * U);
      ctx.stroke();
    }

    // uchwyt
    const hw = 10 * U;
    const g = ctx.createLinearGradient(0, 2 * U, 0, hh - 2 * U);
    g.addColorStop(0, '#5A606C');
    g.addColorStop(1, '#2A2D34');
    ctx.fillStyle = g;
    roundRect(ctx, x - hw / 2, 2 * U, hw, hh - 4 * U, 3 * U);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * U;
    ctx.beginPath();
    ctx.moveTo(x, 4 * U);
    ctx.lineTo(x, hh - 4 * U);
    ctx.stroke();
  });

  const canvas = view.canvas;
  let dragging = false;

  function update(clientX) {
    const r = canvas.getBoundingClientRect();
    const half = 5 * U;
    const span = r.width - 2 * half;
    let v = Math.min(1, Math.max(0, (clientX - r.left - half) / span));
    if (centerDetent && Math.abs(v - 0.5) < 0.03) v = 0.5;
    cur = v;
    read.textContent = readout(v);
    view.redraw();
    onChange(v);
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    update(e.clientX);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) update(e.clientX);
  });
  const end = () => {
    dragging = false;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const el = h('div', 'fader', null, h('div', 'flabel', { text: label }), canvas, read);
  return {
    el,
    /** Ustawia wartość 0..1 bez wywoływania onChange. */
    set(v) {
      cur = v;
      read.textContent = readout(v);
      view.redraw();
    },
  };
}
