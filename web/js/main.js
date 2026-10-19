// Ekran samplera i start aplikacji — port SamplerScreen.kt + MainActivity.kt.

import { Engine, MAX_SECONDS } from './engine.js';
import { BASE_BPM } from './synth.js';
import { createPad } from './pads.js';
import { createDeck } from './deck.js';
import { createIntro } from './intro.js';
import { DELAY_DIVS } from './fx.js';
import { BANK_IDS, listBanks, loadBank, saveBank } from './banks.js';
import { CompactKnob, ConsoleButton, ConsoleColors, LevelMeter, h, toast, updateUnit } from './ui.js';

const SLOT_COLORS = ['#00E5FF', '#76FF03', '#FF4081', '#FFD740'];

// Klawisze (wg położenia na klawiaturze, niezależnie od układu): one-shoty, pętle, sloty REC.
const KEY_ROWS = [
  { codes: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU'], pad0: 0 },
  { codes: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ'], pad0: 7 },
  { codes: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'], pad0: 14 },
];
const SLOT_KEYS = ['KeyZ', 'KeyX', 'KeyC', 'KeyV'];

function mountSampler(root, engine) {
  const settings = { edgeGlow: true, doubleTapLoop: true };
  const ticks = [];

  // ---------- wybór plików ----------
  const fileInput = h('input', null, { type: 'file', accept: 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac' });
  fileInput.style.display = 'none';
  document.body.append(fileInput);
  let onFile = null;
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    const cb = onFile;
    onFile = null;
    fileInput.value = '';
    if (f && cb) cb(f);
  });
  function pickFile(cb) {
    onFile = cb;
    fileInput.click();
  }

  // ---------- pasek górny ----------
  const meter = LevelMeter();
  ticks.push(() => meter.tick(engine.takePeak()));

  let bpm = BASE_BPM;
  let semis = 0;
  const tempoKnob = CompactKnob({
    label: 'TEMPO',
    value: bpm,
    min: 60,
    max: 180,
    def: BASE_BPM,
    step: 1,
    color: ConsoleColors.Cyan,
    readout: (v) => `${Math.round(v)} BPM`,
    onChange: (v) => {
      bpm = v;
      engine.setTempo(v / BASE_BPM);
    },
  });
  const keyKnob = CompactKnob({
    label: 'KEY',
    value: semis,
    min: -12,
    max: 12,
    def: 0,
    step: 1,
    color: '#FF9100',
    readout: (v) => (v > 0 ? '+' : '') + `${Math.round(v)} ST`,
    onChange: (v) => {
      semis = v;
      engine.setPitch(Math.pow(2, v / 12));
    },
  });

  // ---------- pasek efektów ----------
  const fxState = { filter: 0, res: 25, dtime: 1, dfb: 35, dmix: 0, rmix: 0 };
  const fxApply = {
    filter: (v) => engine.fx.setFilter(v / 100),
    res: (v) => engine.fx.setRes(v / 100),
    dtime: (v) => engine.fx.setDelayDiv(v),
    dfb: (v) => engine.fx.setDelayFeedback(v / 100),
    dmix: (v) => engine.fx.setDelayMix(v / 100),
    rmix: (v) => engine.fx.setReverbMix(v / 100),
  };
  const fxSpecs = [
    { key: 'filter', label: 'FILTER', min: -100, max: 100, def: 0, color: '#FFD740',
      readout: (v) => (Math.abs(v) < 2 ? 'OFF' : (v < 0 ? 'LP ' : 'HP ') + Math.round(Math.abs(v)) + '%') },
    { key: 'res', label: 'RES', min: 0, max: 100, def: 25, color: '#FFD740', readout: (v) => Math.round(v) + '%' },
    { key: 'dtime', label: 'DLY TIME', min: 0, max: 3, def: 1, color: '#40C4FF', readout: (v) => DELAY_DIVS[Math.round(v)].label },
    { key: 'dfb', label: 'DLY FDBK', min: 0, max: 90, def: 35, color: '#40C4FF', readout: (v) => Math.round(v) + '%' },
    { key: 'dmix', label: 'DLY MIX', min: 0, max: 100, def: 0, color: '#40C4FF', readout: (v) => Math.round(v) + '%' },
    { key: 'rmix', label: 'REV MIX', min: 0, max: 100, def: 0, color: '#B388FF', readout: (v) => Math.round(v) + '%' },
  ];
  const fxKnobs = {};
  for (const sp of fxSpecs) {
    fxKnobs[sp.key] = CompactKnob({
      label: sp.label,
      value: sp.def,
      min: sp.min,
      max: sp.max,
      def: sp.def,
      step: 1,
      color: sp.color,
      readout: sp.readout,
      small: true,
      onChange: (v) => {
        fxState[sp.key] = v;
        fxApply[sp.key](v);
      },
    });
  }

  // ---------- banki ----------
  const bankHave = new Set();
  let saveArmed = false;
  const bankBtns = BANK_IDS.map((id) => {
    const b = ConsoleButton(id, ConsoleColors.Green, () => onBank(id));
    return { id, b };
  });
  const bSave = ConsoleButton('SAVE', ConsoleColors.Red, () => {
    saveArmed = !saveArmed;
    bSave.setLit(saveArmed);
    if (saveArmed) toast('Wybierz bank, do którego zapisać ustawienia');
  });

  function refreshBankLeds() {
    for (const { id, b } of bankBtns) b.setLit(bankHave.has(id));
  }

  async function collectBank() {
    return {
      v: 1,
      savedAt: Date.now(),
      settings: {
        bpm,
        semis,
        glow: settings.edgeGlow,
        doubleTap: settings.doubleTapLoop,
        fx: { ...fxState },
        deck: deck.getState(),
        loopModes: [...engine.loopModes],
      },
      slots: engine.slots.map((sl) =>
        sl.status === 'ready' && sl.data ? { name: sl.name, loop: sl.loop, data: sl.data } : null
      ),
    };
  }

  function applyBank(bank) {
    const st = bank.settings || {};
    engine.stopAll();
    engine.setLoopModes(st.loopModes || []);

    bpm = st.bpm ?? BASE_BPM;
    tempoKnob.setValue(bpm);
    engine.setTempo(bpm / BASE_BPM);
    semis = st.semis ?? 0;
    keyKnob.setValue(semis);
    engine.setPitch(Math.pow(2, semis / 12));

    for (const sp of fxSpecs) {
      const v = (st.fx && st.fx[sp.key]) ?? sp.def;
      fxState[sp.key] = v;
      fxKnobs[sp.key].setValue(v);
      fxApply[sp.key](v);
    }

    settings.edgeGlow = st.glow !== false;
    settings.doubleTapLoop = st.doubleTap !== false;
    bGlow.setLit(settings.edgeGlow);
    bTap.setLit(settings.doubleTapLoop);
    root.classList.toggle('glow-on', settings.edgeGlow);

    deck.setState(st.deck);

    engine.slots.forEach((sl, i) => {
      const sd = bank.slots && bank.slots[i];
      engine.restoreSlot(sl, sd ? sd.data : null, sd ? sd.name : '', sd ? sd.loop : false);
    });
  }

  async function onBank(id) {
    try {
      if (saveArmed) {
        saveArmed = false;
        bSave.setLit(false);
        await saveBank(id, await collectBank());
        bankHave.add(id);
        refreshBankLeds();
        toast(`Zapisano w banku ${id}`);
      } else {
        if (!bankHave.has(id)) {
          toast(`Bank ${id} jest pusty — kliknij SAVE, potem bank`);
          return;
        }
        const bank = await loadBank(id);
        if (!bank) {
          bankHave.delete(id);
          refreshBankLeds();
          toast(`Bank ${id} jest pusty`);
          return;
        }
        applyBank(bank);
        toast(`Wczytano bank ${id}`);
      }
    } catch (e) {
      console.error(e);
      toast('Zapis niedostępny w tej przeglądarce (tryb prywatny?)');
    }
  }

  listBanks()
    .then((ids) => {
      ids.forEach((i) => bankHave.add(i));
      refreshBankLeds();
    })
    .catch(() => {});

  const fxbar = h(
    'div',
    'fxbar panel',
    null,
    h('div', 'fxtitle', { text: 'FX' }),
    ...fxSpecs.map((sp) => fxKnobs[sp.key].el),
    h('div', 'banks', null, h('div', 'fxtitle', { text: 'BANK' }), ...bankBtns.map((x) => x.b.el), bSave.el)
  );

  const bGlow = ConsoleButton('GLOW', ConsoleColors.Green, () => {
    settings.edgeGlow = !settings.edgeGlow;
    bGlow.setLit(settings.edgeGlow);
    root.classList.toggle('glow-on', settings.edgeGlow);
  }, { lit: true });
  const bTap = ConsoleButton('2xTAP', ConsoleColors.Amber, () => {
    settings.doubleTapLoop = !settings.doubleTapLoop;
    bTap.setLit(settings.doubleTapLoop);
  }, { lit: true });
  const bStop = ConsoleButton('STOP', ConsoleColors.Red, () => engine.stopAll());

  // zapis miksu do pliku (Opus; w Safari AAC)
  const bRecMix = ConsoleButton('REC MIX', ConsoleColors.Red, () => toggleMixRecording());
  async function toggleMixRecording() {
    if (!engine.mixRecording) {
      engine.startMixRecording();
      return;
    }
    const res = await engine.stopMixRecording();
    if (!res) {
      toast('Zapis jest pusty — nic do zapisania');
      return;
    }
    const name = `sampler-${timestamp()}.${res.ext}`;
    downloadBlob(res.blob, name);
    toast(`Zapisano ${name} (${res.label}, ${(res.blob.size / 1048576).toFixed(2)} MB)`);
  }
  ticks.push(() => {
    const rec = engine.mixRecording;
    bRecMix.setLit(rec && Math.floor(performance.now() / 500) % 2 === 0);
    bRecMix.setText(rec ? '■ ' + fmtClock(engine.mixElapsed()) : 'REC MIX');
  });

  for (const b of [bGlow, bTap, bStop, bRecMix]) {
    b.el.style.width = `calc(${b === bTap ? 58 : b === bRecMix ? 64 : 54} * var(--u))`;
    b.el.style.flex = 'none';
  }

  const topbar = h(
    'div',
    'topbar panel',
    null,
    h('div', 'title', { text: 'SAMPLER' }),
    meter.el,
    tempoKnob.el,
    keyKnob.el,
    bGlow.el,
    bTap.el,
    bStop.el,
    bRecMix.el
  );

  // ---------- siatka padów ----------
  const padsPanel = h('div', 'pads-panel panel');
  const presetPads = new Map(); // id -> pad
  const keyTargets = new Map(); // code -> { press(shift), release() }

  engine.pads.forEach((p, i) => {
    const row = KEY_ROWS.find((r) => i >= r.pad0 && i < r.pad0 + r.codes.length);
    const code = row ? row.codes[i - row.pad0] : null;
    const pad = createPad({
      label: p.label,
      color: p.color,
      keyHint: code ? code.replace('Key', '').replace('Digit', '') : '',
      doubleTapEnabled: () => settings.doubleTapLoop,
      onPress: () => engine.press(p),
      onDoubleTap: () => engine.toggleLoopMode(p),
    });
    presetPads.set(p.id, pad);
    padsPanel.append(pad.el);
    if (code) keyTargets.set(code, pad);
  });

  // w układzie pionowym (4 kolumny) sloty zaczynają się w nowym rzędzie
  padsPanel.append(h('div', 'pad-spacer'));

  const slotUis = engine.slots.map((slot) => {
    const pad = createPad({
      label: `REC ${slot.index + 1}`,
      color: SLOT_COLORS[slot.index],
      keyHint: SLOT_KEYS[slot.index].replace('Key', ''),
      doubleTapEnabled: () => settings.doubleTapLoop,
      onPress: () => engine.pressSlot(slot),
      onDoubleTap: () => engine.toggleSlotLoopMode(slot),
    });
    const bMic = ConsoleButton('MIC', ConsoleColors.Red, () => {
      if (slot.status === 'recording') engine.stopRecording();
      else engine.startRecording(slot);
    });
    const bFile = ConsoleButton('FILE', ConsoleColors.Amber, () => {
      if (slot.status === 'recording' || slot.status === 'loading') return;
      pickFile((f) => engine.loadFile(slot, f));
    });
    const bClr = ConsoleButton('CLR', ConsoleColors.Label, () => engine.clearSlot(slot));
    const el = h('div', 'slot', null, pad.el, h('div', 'slot-btns', null, bMic.el, bFile.el, bClr.el));
    padsPanel.append(el);
    keyTargets.set(SLOT_KEYS[slot.index], pad);

    // przeciągnij plik audio na kafelek
    wireDrop(el, (f) => engine.loadFile(slot, f));
    return { slot, pad, bMic, bFile, el };
  });

  function refreshLoops() {
    for (const p of engine.pads) {
      const ui = presetPads.get(p.id);
      ui.setTag(engine.loopModes.has(p.id) ? 'LOOP' : '');
      ui.setActive(engine.activeLoops.has(p.id));
    }
    for (const s of slotUis) s.pad.setActive(engine.activeLoops.has(s.slot.padId));
  }

  function refreshSlots() {
    for (const { slot, pad, bMic, bFile } of slotUis) {
      const recording = slot.status === 'recording';
      let tag;
      switch (slot.status) {
        case 'empty':
          tag = 'EMPTY';
          break;
        case 'recording':
          tag = `${slot.seconds.toFixed(1)}/${MAX_SECONDS} s`;
          break;
        case 'loading':
          tag = 'LOADING...';
          break;
        default:
          tag = slot.name.slice(0, 12) + (slot.loop ? ' LOOP' : '');
      }
      pad.setTag(tag);
      pad.setColor(recording ? ConsoleColors.Red : SLOT_COLORS[slot.index]);
      pad.setEnabled(slot.status === 'ready');
      pad.setActive(recording || engine.activeLoops.has(slot.padId));
      bMic.setLit(recording);
      bFile.setLit(slot.status === 'loading');
    }
  }

  // ---------- deck ----------
  const deck = createDeck(engine, { onLoad: () => pickFile((f) => engine.loadDeck(f)) });
  ticks.push((now) => deck.tick(now));
  wireDrop(deck.el, (f) => engine.loadDeck(f));

  const body = h('div', 'body', null, padsPanel, deck.el);
  root.replaceChildren(topbar, body, fxbar);
  root.classList.add('glow-on');

  // ---------- zdarzenia silnika ----------
  engine.on((evt, payload) => {
    if (evt === 'loops') refreshLoops();
    else if (evt === 'slots') {
      refreshSlots();
      refreshLoops();
    }
  });
  refreshLoops();
  refreshSlots();

  // ---------- klawiatura ----------
  const held = new Map(); // code -> target
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) engine.deckTogglePlay();
      return;
    }
    if (e.code === 'KeyM') {
      e.preventDefault();
      if (!e.repeat) toggleMixRecording();
      return;
    }
    if (e.code === 'Escape') {
      if (!e.repeat) engine.stopAll();
      return;
    }
    const target = keyTargets.get(e.code);
    if (!target) return;
    e.preventDefault();
    if (e.repeat || held.has(e.code)) return;
    held.set(e.code, target);
    target.press(e.shiftKey); // Shift + klawisz = przełączenie one-shot / pętla
  });
  const releaseKey = (e) => {
    const t = held.get(e.code);
    if (t) {
      held.delete(e.code);
      t.release();
    }
  };
  window.addEventListener('keyup', releaseKey);
  window.addEventListener('blur', () => {
    for (const t of held.values()) t.release();
    held.clear();
  });

  // ---------- pętla rysowania ----------
  function frame(now) {
    for (const t of ticks) t(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // pierwsze pełne rozmieszczenie po zmianie rozmiaru okna
  window.addEventListener('resize', () => deck.redraw());
}

function fmtClock(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Pobranie pliku w przeglądarce (link z atrybutem download). */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Przeciągnij i upuść plik audio na element. */
function wireDrop(el, onFile) {
  let depth = 0;
  el.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    el.classList.add('dragover');
  });
  el.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) el.classList.remove('dragover');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    el.classList.remove('dragover');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  });
}

function hasFiles(e) {
  return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
}

// ====================================================================== start

updateUnit();
window.addEventListener('resize', updateUnit);
window.addEventListener('orientationchange', updateUnit);

// upuszczenie pliku obok kafelków nie powinno przenosić przeglądarki na plik
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
window.addEventListener('contextmenu', (e) => e.preventDefault());

const engine = new Engine();
engine.on((evt, payload) => {
  if (evt === 'toast') toast(payload);
});

const samplerEl = document.getElementById('sampler');
const introEl = document.getElementById('intro');

const intro = createIntro(introEl, () => {
  // engine.start() tworzy AudioContext synchronicznie — musimy być wciąż w obrębie gestu
  engine
    .start()
    .then(() => {
      samplerEl.hidden = false;
      mountSampler(samplerEl, engine);
      requestAnimationFrame(() => requestAnimationFrame(() => samplerEl.classList.add('show')));
      intro.destroy();
    })
    .catch((err) => {
      console.error(err);
      const msg = !window.isSecureContext
        ? 'WYMAGANE HTTPS LUB LOCALHOST'
        : err && /AudioWorklet/.test(err.message)
          ? 'PRZEGLĄDARKA NIE OBSŁUGUJE AUDIOWORKLET'
          : 'BŁĄD AUDIO — DOTKNIJ PONOWNIE';
      intro.fail(msg);
    });
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
