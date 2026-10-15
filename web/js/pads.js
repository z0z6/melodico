// Kafelek w stylu kontrolera DJ — port PadTile.kt.
// Reakcja na pierwsze dotknięcie jest natychmiastowa. Jeśli drugie dotknięcie przyjdzie w ciągu
// DOUBLE_TAP_MS i podwójne dotknięcie jest włączone, zamiast onPress wywoływane jest onDoubleTap.

import { h, hexToRgb } from './ui.js';

/** Maksymalny odstęp między dwoma dotknięciami, żeby liczyły się jako podwójne kliknięcie. */
const DOUBLE_TAP_MS = 280;

/**
 * @param {object} o
 * @param {string} o.label
 * @param {string} o.color  #RRGGBB
 * @param {string} [o.keyHint]
 * @param {() => boolean} o.doubleTapEnabled
 * @param {() => void} o.onPress
 * @param {() => void} o.onDoubleTap
 */
export function createPad({ label, color, keyHint, doubleTapEnabled, onPress, onDoubleTap }) {
  const el = h('div', 'pad');
  const labelEl = h('div', 'plabel', { text: label });
  const tagEl = h('div', 'ptag');
  el.append(h('div', 'led'), labelEl, tagEl);
  if (keyHint) el.append(h('div', 'khint', { text: keyHint }));

  let enabled = true;
  let lastDown = 0;
  let pressed = false;

  function setColor(hex) {
    el.style.setProperty('--c', hex);
    el.style.setProperty('--cr', hexToRgb(hex).join(' '));
  }
  setColor(color);

  /** @param {boolean} [forceDouble] wymuszone przełączenie trybu (np. Shift + klawisz) */
  function press(forceDouble = false) {
    if (!enabled || pressed) return;
    const now = performance.now();
    const delta = now - lastDown;
    const isDouble = forceDouble || (doubleTapEnabled() && delta > 0 && delta <= DOUBLE_TAP_MS);
    lastDown = isDouble ? 0 : now;
    pressed = true;
    el.classList.add('pressed');
    if (isDouble) onDoubleTap();
    else onPress();
  }

  function release() {
    if (!pressed) return;
    pressed = false;
    el.classList.remove('pressed');
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch (_) {
      /* ignoruj */
    }
    press(false);
  });
  const up = () => release();
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);

  return {
    el,
    press,
    release,
    setColor,
    setTag(t) {
      const v = t || '';
      if (tagEl.textContent !== v) tagEl.textContent = v;
    },
    setActive(on) {
      el.classList.toggle('active', !!on);
    },
    setEnabled(on) {
      enabled = !!on;
      el.classList.toggle('disabled', !enabled);
      if (!enabled) release();
    },
    get enabled() {
      return enabled;
    },
  };
}
