# Sampler

Sampler / looper na Androida (Kotlin + Jetpack Compose), orientacja pozioma, wygląd konsolety DJ.

- 12 kafelków z presetami (6 one-shotów, 6 pętli), syntezowane w kodzie
- 4 sloty REC: nagrywanie z mikrofonu lub wczytanie pliku audio (max 10 s), opcjonalnie w pętli
- pokrętła TEMPO (60–180 BPM) i KEY (±12 półtonów); podwójne dotknięcie = reset
- przełącznik EDGE GLOW: świecące krawędzie kafelków po dotknięciu

Budowanie lokalnie: `gradle assembleDebug` (lub po `gradle wrapper` → `./gradlew assembleDebug`).
W GitHub Actions: zakładka Actions → ostatni przebieg → artefakt `sampler-debug-apk`.
