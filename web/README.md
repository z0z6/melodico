# Sampler — wersja webowa

Port aplikacji na Androida do przeglądarki. Zero zależności i zero kroku budowania:
czysty JavaScript (moduły ES), Web Audio API + **AudioWorklet**, UI w DOM + Canvas.

## Uruchomienie lokalnie

```bash
cd web
python3 -m http.server 8080      # albo: npx serve .
```

Otwórz <http://localhost:8080>. Strona musi być serwowana po **HTTP(S)**, nie z `file://`
(AudioWorklet i moduły ES tego nie obsługują), a mikrofon wymaga **HTTPS lub `localhost`**.

## Wdrożenie

Katalog `web/` to gotowa statyczna strona — wystarczy wrzucić go na dowolny hosting.
Dla GitHub Pages jest workflow `.github/workflows/pages.yml`
(Settings → Pages → Source: **GitHub Actions**).

## Sterowanie

| Co | Mysz / dotyk | Klawiatura |
|---|---|---|
| Kafelki one-shot (KICK…COWBELL) | klik / dotknięcie | `Q W E R T Y U` |
| Kafelki pętli (BEAT…SHAKER) | klik / dotknięcie | `A S D F G H J` |
| Nowe kafelki: RIM, CRASH, 808, ZAP, STAB, RISER, FUNK, ACID, LEAD | klik / dotknięcie | `1 2 3 4 5 6 7 8 9` |
| Sloty REC 1–4 | klik / dotknięcie | `Z X C V` |
| Przełączenie one-shot ⇄ pętla | podwójne kliknięcie (`2xTAP`) | `Shift` + klawisz |
| Deck: PLAY / PAUSE | przycisk | `Spacja` |
| STOP (wszystko) | przycisk | `Esc` |
| Scratch | przeciąganie po płycie po okręgu | – |
| TEMPO / KEY | przeciąganie pokrętła (↑/→ więcej), kółko myszy, podwójne kliknięcie = reset | – |
| Efekty FILTER / RES / DLY / REV | pokrętła na pasku FX (podwójne kliknięcie = reset) | – |
| Zapis miksu do pliku | `REC MIX` (start / stop → plik się pobiera) | `M` |
| Banki A–D | `SAVE`, potem bank = zapis; sam bank = wczytanie | – |
| Wczytanie pliku | `FILE` / `LOAD` albo **przeciągnij plik audio** na kafelek REC lub deck | – |

## Efekty (pasek FX)

Efekty działają na całym miksie (kafelki i deck), natywnymi węzłami Web Audio (`js/fx.js`):

- **FILTER** – jedno pokrętło: w lewo filtr dolnoprzepustowy (LP), w prawo górnoprzepustowy (HP), środek = wyłączony.
- **RES** – rezonans filtra (0–12 dB).
- **DLY TIME / FDBK / MIX** – delay zsynchronizowany z pokrętłem TEMPO (1/16, 1/8, 1/8 z kropką, 1/4),
  ze ściemnianiem powtórek; FDBK to sprzężenie zwrotne (0–90 %).
- **REV MIX** – pogłos (konwolucja z generowaną odpowiedzią impulsową, ok. 2,2 s).

## Zapis do pliku

`REC MIX` nagrywa to, co słychać: kafelki, deck i efekty. Po zatrzymaniu przeglądarka pobiera plik
`sampler-RRRRMMDD-GGMMSS.<ext>`. Format dobrany pod najlepszy stosunek jakości do rozmiaru:

- **Opus 128 kb/s** (`.webm`, w niektórych przeglądarkach `.ogg`) – ok. 1 MB na minutę, jakość zbliżona do oryginału,
- **AAC** (`.m4a`) – tylko w Safari, które nie koduje Opusa w MediaRecorderze.

Pliki `.webm` z Opusem odtworzą m.in. Chrome, Firefox, Edge i VLC. W przeglądarkowym nagraniu
brakuje metadanych długości, więc niektóre odtwarzacze nie pokazują czasu trwania ani nie pozwalają przewijać.

## Banki

Cztery banki (A–D) w IndexedDB przeglądarki (`js/banks.js`). Zapisują: tempo, tonację, ustawienia efektów,
GLOW / 2xTAP, tryb (one-shot / pętla) każdego kafelka, pitch / vol / loop decka oraz **próbki ze slotów REC**.
Nie zapisują tracka z decka (za duży). Zapis: `SAVE` (świeci się) → klik w bank. Wczytanie: klik w bank
(świecąca dioda = bank zawiera dane). Dane są lokalne dla przeglądarki i adresu strony.

## Mapowanie Android → web

| Android (Kotlin) | Web |
|---|---|
| `AudioTrack` + wątek miksera | `AudioWorkletProcessor` (`js/worklet.js`) |
| `AudioEngine.render/mixLoop/mixOneShot/mixDeck` | 1:1 w `worklet.js` (granularny time-stretch, scratch, bezwładność silnika) |
| `SynthPresets` | `js/synth.js` (generowane przy starcie w częstotliwości kontekstu) |
| `AudioRecord` (mikrofon) | `getUserMedia` + procesor `recorder` w osobnym `AudioContext` |
| `MediaExtractor`/`MediaCodec` | `decodeAudioData` (mp3, wav, ogg, m4a/aac… zależnie od przeglądarki) |
| `SamplerScreen`, `PadTile`, `Knob`, `Fader`, `Deck`, `Intro` | `main.js`, `pads.js`, `ui.js`, `deck.js`, `intro.js` |
| Zgoda `RECORD_AUDIO` | monit przeglądarki przy pierwszym użyciu MIC |
| Jednostka `dp` | `calc(N * var(--u))`; `--u` skaluje cały układ do okna |

## Różnice względem aplikacji

- Dźwięk startuje po pierwszym dotknięciu na intro (wymóg autoplay przeglądarek).
- Pliki dekodowane są w całości w pamięci (deck: do 6 min, REC: do 10 s) — bardzo duże pliki
  na słabych telefonach mogą się nie wczytać.
- Układ pionowy jest dostępny (siatka 4 kolumny + deck pod spodem), ale zamierzony jest poziomy.
- Dodatki webowe: klawiatura, drag & drop plików, kółko myszy na pokrętłach, instalacja jako PWA
  (manifest + service worker, offline po pierwszym wejściu), 9 dodatkowych presetów, efekty i banki.
