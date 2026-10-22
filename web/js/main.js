// Start aplikacji — port MainActivity.kt: intro, potem ekran samplera (js/sampler.js).

import { Engine } from './engine.js';
import { createIntro } from './intro.js';
import { mountSampler } from './sampler.js';
import { toast, updateUnit } from './ui.js';

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
