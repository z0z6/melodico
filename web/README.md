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
(Settings → Pages → Source: **GitHub Actions**) albo wrzuć zawartość jako katalog `docs`
(Settings → Pages → Deploy from a branch → `/docs`).

## Układ

```
┌ SAMPLER ▮▮▮ miernik │ MASTER │ TEMPO │ KEY │ GLOW 2xTAP STOP REC MIX ┐
├───────────────────────────────────────────────┬────────────────────────┤
│ strona kafelków (18):                         │  DECK A                │
│   rząd 1: dźwięki jednorazowe (9)             │  (płyta, scratch,      │
│   rząd 2: pętle (9)                           │   PLAY CUE LOOP,       │
│ stały dolny rząd:                             │   PITCH, VOL)          │
│   REC 1–4 │ MIX 1–4 │ PAGE                    │                        │
├───────────────────────────────────────────────┴────────────────────────┤
│ PAD ▸ [wybrany kafelek]  VOL  TEMPO  TONE  RESET  FX │ BANK A B C D SAVE│
│ FX ▸ FILTER RES DLY TIME DLY FDBK DLY MIX REV MIX   (zwijany przyciskiem FX)│
└────────────────────────────────────────────────────────────────────────┘
```

## Sterowanie

| Co | Mysz / dotyk | Klawiatura |
|---|---|---|
| Kafelki: rząd 1 (dźwięki jednorazowe) | klik / dotknięcie | `1 2 3 4 5 6 7 8 9` |
| Kafelki: rząd 2 (pętle) | klik / dotknięcie | `Q W E R T Y U I O` |
| REC 1–4 | klik / dotknięcie | `A S D F` |
| MIX 1–4 (pojemniki) | klik / dotknięcie | `G H J K` |
| Zmiana strony kafelków (3 strony) | kafelek `PAGE` | `L`, `←` / `→` |
| Przełączenie one-shot ⇄ pętla | podwójne kliknięcie (`2xTAP`) | `Shift` + klawisz |
| Deck: PLAY / PAUSE | przycisk | `Spacja` |
| STOP (wszystko) / wyjście z trybu ADD | przycisk | `Esc` |
| Zapis miksu do pliku | `REC MIX` | `M` |
| Scratch | przeciąganie po płycie po okręgu | – |
| Pokrętła i suwaki | przeciąganie (↑/→ więcej), kółko myszy, podwójne kliknięcie = reset | – |
| Wczytanie pliku | `FILE` / `LOAD` albo **przeciągnij plik audio** na kafelek REC lub deck | – |

## Strony kafelków (54 presety)

| Strona | Rząd 1 (jednorazowe) | Rząd 2 (pętle) |
|---|---|---|
| **1 · DRUMS** | KICK, KICK 2, SNARE, SNARE 2, CLAP, HAT, OPEN HAT, CRASH, RIDE | BEAT, HOUSE, FUNK, TECHNO, TRAP, BREAK, LATIN, HATS 16, SHAKER |
| **2 · PERC · BASS** | TOM, TOM HI, TOM LO, COWBELL, RIM, CONGA, CLAVES, TRIANGLE, SNAP | 808, 808 LONG, SUB, REESE (jednorazowe) + BASS, ACID, WOBBLE, ROLL, DUB (pętle) |
| **3 · SYNTH · FX** | ZAP, STAB, RISER, IMPACT, DOWNER, SIREN, PLUCK, BELL, BRASS | ARP, CHORD, LEAD, ARP 2, PLUCKS, PAD, BELLS, ORGAN, AIR |

Wszystkie pętle trwają 1 takt (2 s przy 120 BPM) i są zsynchronizowane. Dźwięki są generowane w kodzie
przy starcie (`js/synth.js`). Tryb każdego kafelka (one-shot / pętla) można zmienić.

## Pasek PAD — głośność, tempo i barwa każdego kafelka

Ostatnio dotknięty kafelek (preset, REC lub pojemnik MIX) jest *wybrany* (biała ramka, nazwa na pasku PAD).
Jego pokrętła:

- **VOL** 0–200 % — głośność kafelka,
- **TEMPO** 50–200 % — prędkość odtwarzania **bez zmiany wysokości** (granularny time-stretch; pętle zmieniają
  tempo na żywo, jednorazowe dźwięki — przy kolejnym uderzeniu),
- **TONE** — barwa: w lewo ciemniej (więcej basu), w prawo jaśniej (więcej góry), środek = bez zmian,
- **RESET** przywraca ustawienia wybranego kafelka.

Ustawienia są niezależne dla każdego kafelka i nakładają się na globalne TEMPO / KEY oraz na MASTER i efekty.

## MASTER

Główny suwak głośności w górnym pasku (środek 0 dB, do +4 dB, skrajnie w lewo = MUTE). Działa na wszystko, także
na plik zapisywany przyciskiem `REC MIX`.

## Pojemniki MIX — własne klocki z kilku dźwięków

Cztery kafelki `MIX 1–4` w dolnym rzędzie to „pojemniczki”. Każdy ma przyciski:

1. **ADD** — włącza tryb dodawania: kliknięcia kafelków (z dowolnej strony, także REC i inne MIX) *nie grają*,
   tylko dodają lub usuwają składniki (przerywana ramka; do 8 sztuk). `ADD` jeszcze raz albo `Esc` kończy wybór.
2. **BAKE** — miksuje składniki w jeden nowy dźwięk, uwzględniając ich VOL / TEMPO / TONE oraz tryb
   (pętle zapętlają się, jednorazowe grają raz). Wynik (do 12 s) jest normalizowany i gra jak każdy kafelek;
   jeśli wśród składników była pętla, klocek jest pętlą (podwójne kliknięcie zmienia tryb).
3. **CLR** — czyści pojemnik (składniki i dźwięk).

Składniki zostają zapamiętane, więc po zmianie ustawień kafelków można ponownie nacisnąć `BAKE`.
Uwaga: pętla z TEMPO ≠ 100 % nie musi pasować do długości taktu, więc przy zapętleniu klocka może być słychać szew.

## Efekty (pasek FX, przycisk `FX`)

Efekty działają na całym miksie (kafelki i deck), natywnymi węzłami Web Audio (`js/fx.js`):

- **FILTER** – w lewo filtr dolnoprzepustowy (LP), w prawo górnoprzepustowy (HP), środek = wyłączony.
- **RES** – rezonans filtra (0–12 dB).
- **DLY TIME / FDBK / MIX** – delay zsynchronizowany z pokrętłem TEMPO (1/16, 1/8, 1/8 z kropką, 1/4).
- **REV MIX** – pogłos (konwolucja z generowaną odpowiedzią impulsową, ok. 2,2 s).

## Zapis do pliku

`REC MIX` nagrywa to, co słychać: kafelki, deck, efekty i MASTER. Po zatrzymaniu przeglądarka pobiera plik
`sampler-RRRRMMDD-GGMMSS.<ext>`. Format dobrany pod najlepszy stosunek jakości do rozmiaru:

- **Opus 128 kb/s** (`.webm`, w niektórych przeglądarkach `.ogg`) – ok. 1 MB na minutę, jakość zbliżona do oryginału,
- **AAC** (`.m4a`) – tylko w Safari, które nie koduje Opusa w MediaRecorderze.

Pliki `.webm` z Opusem odtworzą m.in. Chrome, Firefox, Edge i VLC. W przeglądarkowym nagraniu
brakuje metadanych długości, więc niektóre odtwarzacze nie pokazują czasu trwania ani nie pozwalają przewijać.

## Banki

Cztery banki (A–D) w IndexedDB przeglądarki (`js/banks.js`). Zapisują: tempo, tonację, MASTER, efekty,
GLOW / 2xTAP, tryb (one-shot / pętla) każdego kafelka, **VOL / TEMPO / TONE każdego kafelka**, stronę, pitch / vol /
loop decka oraz próbki ze slotów REC i **pojemniki MIX (składniki + zmiksowany dźwięk)**.
Nie zapisują tracka z decka (za duży). Zapis: `SAVE` (świeci się) → klik w bank. Wczytanie: klik w bank
(świecąca dioda = bank zawiera dane). Dane są lokalne dla przeglądarki i adresu strony.

## Mapowanie Android → web

| Android (Kotlin) | Web |
|---|---|
| `AudioTrack` + wątek miksera | `AudioWorkletProcessor` (`js/worklet.js`) |
| `AudioEngine.render/mixLoop/mixOneShot/mixDeck` | w `worklet.js` (granularny time-stretch, scratch, bezwładność silnika) + parametry per kafelek |
| `SynthPresets` | `js/synth.js` (generowane przy starcie w częstotliwości kontekstu) |
| `AudioRecord` (mikrofon) | `getUserMedia` + procesor `recorder` w osobnym `AudioContext` |
| `MediaExtractor`/`MediaCodec` | `decodeAudioData` (mp3, wav, ogg, m4a/aac… zależnie od przeglądarki) |
| `SamplerScreen`, `PadTile`, `Knob`, `Fader`, `Deck`, `Intro` | `sampler.js`, `pads.js`, `ui.js`, `deck.js`, `intro.js` |
| Zgoda `RECORD_AUDIO` | monit przeglądarki przy pierwszym użyciu MIC |
| Jednostka `dp` | `calc(N * var(--u))`; `--u` skaluje cały układ do okna |

## Różnice względem aplikacji

- Dźwięk startuje po pierwszym dotknięciu na intro (wymóg autoplay przeglądarek).
- Pliki dekodowane są w całości w pamięci (deck: do 6 min, REC: do 10 s) — bardzo duże pliki
  na słabych telefonach mogą się nie wczytać.
- Układ pionowy jest dostępny (siatka 4 kolumny + deck pod spodem), ale zamierzony jest poziomy.
- Dodatki webowe: klawiatura, drag & drop plików, kółko myszy na pokrętłach, instalacja jako PWA
  (manifest + service worker, offline po pierwszym wejściu), 54 presety na 3 stronach, per-kafelkowe VOL / TEMPO / TONE,
  MASTER, pojemniki MIX, efekty, banki i zapis miksu do pliku.
