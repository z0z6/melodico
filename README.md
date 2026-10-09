# Sampler

Sampler / looper / mini-deck na Androida (Kotlin + Jetpack Compose), orientacja pozioma, wygląd konsolety DJ.

- 14 kafelków z presetami (syntezowane w kodzie) + 4 sloty REC (mikrofon lub plik, max 10 s)
- **podwójne kliknięcie na dowolnym kafelku** przełącza go między one-shotem a pętlą (przełącznik `2xTAP` na górze)
- **deck winylowy**: wczytaj własny track (max 6 min), PLAY / PAUSE / CUE / LOOP, fadery PITCH i VOL,
  scratch przez przeciąganie palca po płycie
- pokrętła TEMPO (60–180 BPM) i KEY (±12 półtonów) działają na pętle i presety; podwójne dotknięcie = reset
- `GLOW`: świecące krawędzie kafelków po dotknięciu
- intro po uruchomieniu (dotknięcie pomija), ikona adaptacyjna w `res/` (źródło: `branding/icon.svg`)

Układ ustawia się stałymi na górze `ui/SamplerScreen.kt` (`PAD_COLUMNS`, `PADS_WEIGHT`, `DECK_WEIGHT`).

Budowanie lokalnie: `gradle assembleDebug` (lub po `gradle wrapper` → `./gradlew assembleDebug`).
W GitHub Actions: zakładka Actions → ostatni przebieg → artefakt `sampler-debug-apk`.
