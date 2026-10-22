// Ekran samplera — port SamplerScreen.kt + rozszerzenia webowe:
//  - 3 strony po 18 presetów (rząd 1: one-shoty, rząd 2: pętle) i stały dolny rząd:
//    4× REC, 4× pojemnik MIX, przycisk PAGE,
//  - pasek PAD: głośność / tempo / barwa dla ostatnio dotkniętego kafelka (dowolnego),
//  - MASTER, pasek efektów, banki, zapis miksu do pliku.

import { MAX_SECONDS, PARAM_LIMITS } from './engine.js';
import { BASE_BPM, PAGE_NAMES, PAGE_SIZE } from './synth.js';
import { createPad } from './pads.js';
import { createDeck } from './deck.js';
import { DELAY_DIVS } from './fx.js';
import { BANK_IDS, listBanks, loadBank, saveBank } from './banks.js';
import { CompactKnob, ConsoleButton, ConsoleColors, HFader, LevelMeter, U, h, toast } from './ui.js';

const SLOT_COLORS = ['#00E5FF', '#76FF03', '#FF4081', '#FFD740'];
const BLOCK_COLORS = ['#FFD54F', '#FF8A65', '#BA68C8', '#4DD0E1'];

// Klawisze wg położenia (niezależnie od układu klawiatury), odwzorowują siatkę:
//   rząd 1 → kafelki 1–9, rząd 2 → kafelki 10–18, rząd 3 → REC ×4, MIX ×4, PAGE.
const KEYS_ROW1 = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];
const KEYS_ROW2 = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO'];
const KEYS_REC = ['KeyA', 'KeyS', 'KeyD', 'KeyF'];
const KEYS_MIX = ['KeyG', 'KeyH', 'KeyJ', 'KeyK'];
const KEY_PAGE = 'KeyL';
const hint = (code) => code.replace('Key', '').replace('Digit', '');

export function mountSampler(root, engine) {
  const settings = { edgeGlow: true, doubleTapLoop: true };
  const ticks = [];
  const keyTargets = new Map(); // kod klawisza -> { press(shift), release() }
  const pageCount = Math.ceil(engine.pads.length / PAGE_SIZE);
  let page = 0;
  let selectedId = engine.pads.length ? engine.pads[0].id : -1;
  /** Pojemnik w trybie dodawania składników (kliknięcia kafelków nie grają, tylko dodają). */
  let addTarget = null;

  // ================================================================ wybór plików
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

  // ================================================================ pasek górny
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

  // główny suwak głośności (0.8 = bez zmiany)
  const masterFader = HFader({
    label: 'MASTER',
    value: engine.masterV,
    color: '#FFFFFF',
    readout: (v) => {
      if (v < 0.005) return 'MUTE';
      const db = 20 * Math.log10(Math.pow(v / 0.8, 2));
      return (db > 0.4 ? '+' : '') + db.toFixed(0) + ' dB';
    },
    onChange: (v) => engine.setMaster(v),
  });
  masterFader.el.classList.add('master');

  const bGlow = ConsoleButton(
    'GLOW',
    ConsoleColors.Green,
    () => {
      settings.edgeGlow = !settings.edgeGlow;
      bGlow.setLit(settings.edgeGlow);
      root.classList.toggle('glow-on', settings.edgeGlow);
    },
    { lit: true }
  );
  const bTap = ConsoleButton(
    '2xTAP',
    ConsoleColors.Amber,
    () => {
      settings.doubleTapLoop = !settings.doubleTapLoop;
      bTap.setLit(settings.doubleTapLoop);
    },
    { lit: true }
  );
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
    masterFader.el,
    tempoKnob.el,
    keyKnob.el,
    bGlow.el,
    bTap.el,
    bStop.el,
    bRecMix.el
  );

  // ================================================================ siatka kafelków
  const padsPanel = h('div', 'pads-panel panel');
  const padAt = (i) => engine.pads[page * PAGE_SIZE + i] || null;

  /** Wspólna obsługa dotknięcia kafelka: tryb dodawania do pojemnika albo wybór + granie. */
  function onTilePress(id, play) {
    if (addTarget) {
      if (id !== addTarget.padId) engine.toggleMember(addTarget, id);
      return;
    }
    select(id);
    play();
  }
  function onTileDouble(id, toggle) {
    if (addTarget) return;
    select(id);
    toggle();
  }

  // --- 18 kafelków dźwięków (zależnych od strony)
  const soundTiles = [];
  const soundKeys = [...KEYS_ROW1, ...KEYS_ROW2];
  for (let i = 0; i < PAGE_SIZE; i++) {
    const tile = createPad({
      label: '',
      color: '#40C4FF',
      keyHint: hint(soundKeys[i]),
      doubleTapEnabled: () => settings.doubleTapLoop,
      onPress: () => {
        const p = padAt(i);
        if (p) onTilePress(p.id, () => engine.press(p));
      },
      onDoubleTap: () => {
        const p = padAt(i);
        if (p) onTileDouble(p.id, () => engine.toggleLoopMode(p));
      },
    });
    soundTiles.push(tile);
    padsPanel.append(tile.el);
    keyTargets.set(soundKeys[i], tile);
  }

  // w układzie pionowym (4 kolumny) dolny rząd zaczyna się od nowej linii
  padsPanel.append(h('div', 'pad-spacer'));

  // --- 4× REC
  const slotUis = engine.slots.map((slot) => {
    const pad = createPad({
      label: `REC ${slot.index + 1}`,
      color: SLOT_COLORS[slot.index],
      keyHint: hint(KEYS_REC[slot.index]),
      doubleTapEnabled: () => settings.doubleTapLoop,
      onPress: () => onTilePress(slot.padId, () => engine.pressSlot(slot)),
      onDoubleTap: () => onTileDouble(slot.padId, () => engine.toggleSlotLoopMode(slot)),
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
    keyTargets.set(KEYS_REC[slot.index], pad);
    wireDrop(el, (f) => engine.loadFile(slot, f)); // przeciągnij plik audio na kafelek
    return { slot, pad, bMic, bFile };
  });

  // --- 4× pojemnik MIX
  const blockUis = engine.blocks.map((block) => {
    const pad = createPad({
      label: `MIX ${block.index + 1}`,
      color: BLOCK_COLORS[block.index],
      keyHint: hint(KEYS_MIX[block.index]),
      doubleTapEnabled: () => settings.doubleTapLoop,
      onPress: () => onTilePress(block.padId, () => engine.pressSlot(block)),
      onDoubleTap: () => onTileDouble(block.padId, () => engine.toggleSlotLoopMode(block)),
    });
    const bAdd = ConsoleButton('ADD', ConsoleColors.Cyan, () => {
      if (block.status === 'loading') return;
      addTarget = addTarget === block ? null : block;
      if (addTarget) toast(`MIX ${block.index + 1}: klikaj dźwięki, które mają się zmiksować. ADD kończy wybór.`);
      refreshAll();
    });
    const bBake = ConsoleButton('BAKE', ConsoleColors.Green, () => {
      addTarget = null;
      engine.bakeBlock(block);
      refreshAll();
    });
    const bClr = ConsoleButton('CLR', ConsoleColors.Label, () => {
      if (addTarget === block) addTarget = null;
      engine.clearSlot(block);
      refreshAll();
    });
    const el = h('div', 'slot block', null, pad.el, h('div', 'slot-btns', null, bAdd.el, bBake.el, bClr.el));
    padsPanel.append(el);
    keyTargets.set(KEYS_MIX[block.index], pad);
    return { block, pad, bAdd, bBake };
  });

  // --- PAGE
  const pageTile = createPad({
    label: 'PAGE',
    color: '#FFC400',
    keyHint: hint(KEY_PAGE),
    doubleTapEnabled: () => false,
    onPress: () => setPage(page + 1),
    onDoubleTap: () => {},
  });
  padsPanel.append(pageTile.el);
  keyTargets.set(KEY_PAGE, pageTile);

  function setPage(p) {
    page = ((p % pageCount) + pageCount) % pageCount;
    refreshAll();
  }

  // ================================================================ pasek PAD (głośność / tempo / barwa)
  const padName = h('div', 'padname', { text: '—' });

  const padKnobs = {
    vol: CompactKnob({
      label: 'VOL',
      value: 100,
      min: PARAM_LIMITS.vol[0] * 100,
      max: PARAM_LIMITS.vol[1] * 100,
      def: 100,
      step: 1,
      color: '#00E676',
      readout: (v) => `${Math.round(v)}%`,
      small: true,
      onChange: (v) => engine.setParam(selectedId, 'vol', v / 100),
    }),
    tempo: CompactKnob({
      label: 'TEMPO',
      value: 100,
      min: PARAM_LIMITS.tempo[0] * 100,
      max: PARAM_LIMITS.tempo[1] * 100,
      def: 100,
      step: 1,
      color: '#40C4FF',
      readout: (v) => `${Math.round(v)}%`,
      small: true,
      onChange: (v) => engine.setParam(selectedId, 'tempo', v / 100),
    }),
    tone: CompactKnob({
      label: 'TONE',
      value: 0,
      min: -100,
      max: 100,
      def: 0,
      step: 1,
      color: '#FFAB40',
      readout: (v) => (Math.abs(v) < 2 ? 'FLAT' : (v < 0 ? 'DARK ' : 'BRIGHT ') + Math.round(Math.abs(v))),
      small: true,
      onChange: (v) => engine.setParam(selectedId, 'tone', v / 100),
    }),
  };
  const bReset = ConsoleButton('RESET', ConsoleColors.Label, () => engine.resetParams(selectedId));
  // pasek efektów: na niskich ekranach (telefon poziomo) domyślnie zwinięty, żeby zostało miejsce na deck
  let fxOpen = window.innerHeight / U >= 420;
  const bFx = ConsoleButton('FX', ConsoleColors.Amber, () => {
    fxOpen = !fxOpen;
    bFx.setLit(fxOpen);
    fxbar.hidden = !fxOpen;
  }, { lit: fxOpen });
  bReset.el.style.width = `calc(44 * var(--u))`;
  bFx.el.style.width = `calc(32 * var(--u))`;
  for (const b of [bReset, bFx]) b.el.style.flex = 'none';

  function labelFor(id) {
    const p = engine.pads.find((x) => x.id === id);
    if (p) return { text: p.label, color: p.color };
    const sl = engine.slots.find((x) => x.padId === id);
    if (sl) return { text: `REC ${sl.index + 1}`, color: SLOT_COLORS[sl.index] };
    const bl = engine.blocks.find((x) => x.padId === id);
    if (bl) return { text: `MIX ${bl.index + 1}`, color: BLOCK_COLORS[bl.index] };
    return { text: '—', color: '#9AA3B2' };
  }

  function updatePadEditor() {
    const lab = labelFor(selectedId);
    padName.textContent = lab.text;
    padName.style.color = lab.color;
    padName.style.borderColor = lab.color;
    const pr = engine.getParams(selectedId);
    padKnobs.vol.setValue(Math.round(pr.vol * 100));
    padKnobs.tempo.setValue(Math.round(pr.tempo * 100));
    padKnobs.tone.setValue(Math.round(pr.tone * 100));
  }

  function select(id) {
    selectedId = id;
    updatePadEditor();
    refreshSelection();
  }

  // ================================================================ banki
  const bankHave = new Set();
  let saveArmed = false;
  const bankBtns = BANK_IDS.map((id) => ({ id, b: ConsoleButton(id, ConsoleColors.Green, () => onBank(id)) }));
  const bSave = ConsoleButton('SAVE', ConsoleColors.Red, () => {
    saveArmed = !saveArmed;
    bSave.setLit(saveArmed);
    if (saveArmed) toast('Wybierz bank, do którego zapisać ustawienia');
  });
  const refreshBankLeds = () => bankBtns.forEach(({ id, b }) => b.setLit(bankHave.has(id)));

  async function collectBank() {
    return {
      v: 2,
      savedAt: Date.now(),
      settings: {
        bpm,
        semis,
        master: engine.masterV,
        glow: settings.edgeGlow,
        doubleTap: settings.doubleTapLoop,
        fx: { ...fxState },
        deck: deck.getState(),
        loopModes: [...engine.loopModes],
        params: [...engine.padParams].map(([id, p]) => ({ id, ...p })),
        page,
      },
      slots: engine.slots.map((sl) =>
        sl.status === 'ready' && sl.data ? { name: sl.name, loop: sl.loop, data: sl.data } : null
      ),
      blocks: engine.blocks.map((bl) => ({
        members: [...bl.members],
        name: bl.name,
        loop: bl.loop,
        data: bl.status === 'ready' && bl.data ? bl.data : null,
      })),
    };
  }

  function applyBank(bank) {
    const st = bank.settings || {};
    addTarget = null;
    engine.stopAll();
    engine.setLoopModes(st.loopModes || []);

    bpm = st.bpm ?? BASE_BPM;
    tempoKnob.setValue(bpm);
    engine.setTempo(bpm / BASE_BPM);
    semis = st.semis ?? 0;
    keyKnob.setValue(semis);
    engine.setPitch(Math.pow(2, semis / 12));

    const master = st.master ?? 0.8;
    masterFader.set(master);
    engine.setMaster(master);

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

    // parametry kafelków: najpierw zerujemy wszystkie, potem ustawiamy zapisane
    for (const id of [...engine.padParams.keys()]) engine.resetParams(id);
    for (const p of st.params || []) engine._storeParams(p.id, p);

    engine.slots.forEach((sl, i) => {
      const sd = bank.slots && bank.slots[i];
      engine.restoreSlot(sl, sd ? sd.data : null, sd ? sd.name : '', sd ? sd.loop : false);
    });
    engine.blocks.forEach((bl, i) => {
      const bd = bank.blocks && bank.blocks[i];
      engine.restoreSlot(bl, bd ? bd.data : null, bd ? bd.name : '', bd ? bd.loop : false);
      bl.members = bd ? [...(bd.members || [])] : [];
    });

    if (typeof st.page === 'number') page = ((st.page % pageCount) + pageCount) % pageCount;
    refreshAll();
    updatePadEditor();
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

  const padbar = h(
    'div',
    'padbar panel',
    null,
    h('div', 'fxtitle', { text: 'PAD' }),
    padName,
    padKnobs.vol.el,
    padKnobs.tempo.el,
    padKnobs.tone.el,
    bReset.el,
    bFx.el,
    h('div', 'banks', null, h('div', 'fxtitle', { text: 'BANK' }), ...bankBtns.map((x) => x.b.el), bSave.el)
  );

  // ================================================================ pasek efektów
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
  const fxbar = h('div', 'fxbar panel', null, h('div', 'fxtitle', { text: 'FX' }), ...fxSpecs.map((sp) => fxKnobs[sp.key].el));
  fxbar.hidden = !fxOpen;

  // ================================================================ deck
  const deck = createDeck(engine, { onLoad: () => pickFile((f) => engine.loadDeck(f)) });
  ticks.push((now) => deck.tick(now));
  wireDrop(deck.el, (f) => engine.loadDeck(f));

  const body = h('div', 'body', null, padsPanel, deck.el);
  root.replaceChildren(topbar, body, padbar, fxbar);
  root.classList.add('glow-on');

  // ================================================================ odświeżanie widoku
  function refreshPads() {
    soundTiles.forEach((tile, i) => {
      const p = padAt(i);
      tile.setLabel(p ? p.label : '');
      if (p) tile.setColor(p.color);
      tile.setEnabled(!!p);
    });
    pageTile.setLabel(`PAGE ${page + 1}/${pageCount}`);
    pageTile.setTag(PAGE_NAMES[page] || '');
  }

  function refreshLoops() {
    soundTiles.forEach((tile, i) => {
      const p = padAt(i);
      tile.setTag(p && engine.loopModes.has(p.id) ? 'LOOP' : '');
      tile.setActive(!!p && engine.activeLoops.has(p.id));
    });
    for (const { slot, pad } of slotUis) if (slot.status !== 'recording') pad.setActive(engine.activeLoops.has(slot.padId));
    for (const { block, pad } of blockUis) pad.setActive(engine.activeLoops.has(block.padId));
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
    for (const { block, pad, bAdd, bBake } of blockUis) {
      const n = block.members.length;
      let tag;
      if (block.status === 'loading') tag = 'BAKING...';
      else if (addTarget === block) tag = `+ ${n} SND`;
      else if (block.status === 'ready') tag = `${n}→${block.seconds.toFixed(1)}s` + (block.loop ? ' LOOP' : '');
      else tag = n ? `${n} SND` : 'EMPTY';
      pad.setTag(tag);
      pad.setEnabled(block.status === 'ready' && addTarget !== block);
      pad.setActive(addTarget === block || engine.activeLoops.has(block.padId));
      bAdd.setLit(addTarget === block);
      bBake.setLit(block.status === 'loading');
    }
  }

  function refreshSelection() {
    soundTiles.forEach((tile, i) => {
      const p = padAt(i);
      tile.setSelected(!!p && p.id === selectedId);
    });
    for (const { slot, pad } of slotUis) pad.setSelected(slot.padId === selectedId);
    for (const { block, pad } of blockUis) pad.setSelected(block.padId === selectedId);
  }

  function refreshMembers() {
    const mem = (id) => !!addTarget && addTarget.members.includes(id);
    soundTiles.forEach((tile, i) => {
      const p = padAt(i);
      tile.setMember(!!p && mem(p.id));
    });
    for (const { slot, pad } of slotUis) pad.setMember(mem(slot.padId));
    for (const { block, pad } of blockUis) pad.setMember(mem(block.padId));
    padsPanel.classList.toggle('adding', !!addTarget);
  }

  function refreshAll() {
    refreshPads();
    refreshSlots();
    refreshLoops();
    refreshSelection();
    refreshMembers();
  }

  engine.on((evt) => {
    if (evt === 'loops') refreshLoops();
    else if (evt === 'slots') {
      refreshSlots();
      refreshLoops();
      refreshMembers();
    } else if (evt === 'params') updatePadEditor();
  });
  refreshAll();
  updatePadEditor();

  // ================================================================ klawiatura
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
      if (e.repeat) return;
      if (addTarget) {
        addTarget = null;
        refreshAll();
      } else engine.stopAll();
      return;
    }
    if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      e.preventDefault();
      if (!e.repeat) setPage(page + (e.code === 'ArrowRight' ? 1 : -1));
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

  // ================================================================ pętla rysowania
  function frame(now) {
    for (const t of ticks) t(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener('resize', () => deck.redraw());
}

// ====================================================================== narzędzia

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
