package pl.sampler.app.audio

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/** Presety syntezowane w kodzie. Pętle mają dokładnie 1 takt przy bazowym tempie 120 BPM. */
object SynthPresets {
    const val SAMPLE_RATE = 44100
    const val BASE_BPM = 120.0

    val BAR_FRAMES: Int = (SAMPLE_RATE * 60.0 / BASE_BPM * 4).roundToInt() // 88200
    private val BEAT_FRAMES = BAR_FRAMES / 4
    private val EIGHTH_FRAMES = BAR_FRAMES / 8

    private val rng = Random(1234)
    private fun noise(): Float = rng.nextFloat() * 2f - 1f

    fun buildPads(): List<Pad> {
        val kick = synthKick()
        val snare = synthSnare()
        val closedHat = synthHat(0.07, 60.0)
        val openHat = synthHat(0.35, 11.0)
        val clap = synthClap()
        val tom = synthTom()
        val cowbell = synthCowbell()

        val beat = synthBeatLoop(kick, snare, closedHat)
        val house = synthHouseLoop(kick, clap, openHat)
        val bass = synthBassLoop()
        val hats16 = synthHats16Loop(closedHat)
        val arp = synthArpLoop()
        val chord = synthChordLoop()
        val shaker = synthShakerLoop()

        return listOf(
            // one-shoty (ciepłe kolory); pętle (zimne kolory). Tryb można zmienić podwójnym kliknięciem.
            Pad(0, "KICK", kick, false, 0xFFFF5252),
            Pad(1, "SNARE", snare, false, 0xFFFF9100),
            Pad(2, "HAT", closedHat, false, 0xFFFFD740),
            Pad(3, "OPEN HAT", openHat, false, 0xFFC6FF00),
            Pad(4, "CLAP", clap, false, 0xFFFF4081),
            Pad(5, "TOM", tom, false, 0xFF69F0AE),
            Pad(6, "COWBELL", cowbell, false, 0xFFFF6E40),
            Pad(7, "BEAT", beat, true, 0xFF40C4FF),
            Pad(8, "HOUSE", house, true, 0xFF448AFF),
            Pad(9, "BASS", bass, true, 0xFFB388FF),
            Pad(10, "HATS 16", hats16, true, 0xFFEA80FC),
            Pad(11, "ARP", arp, true, 0xFF18FFFF),
            Pad(12, "CHORD", chord, true, 0xFF64FFDA),
            Pad(13, "SHAKER", shaker, true, 0xFF80D8FF),
        )
    }

    // ---------- one-shoty ----------

    private fun synthKick(): FloatArray {
        val n = (SAMPLE_RATE * 0.45).toInt()
        val out = FloatArray(n)
        var phase = 0.0
        for (i in 0 until n) {
            val t = i.toDouble() / SAMPLE_RATE
            val freq = 45.0 + 110.0 * exp(-t * 28.0)
            phase += 2 * PI * freq / SAMPLE_RATE
            out[i] = (sin(phase) * exp(-t * 7.0)).toFloat()
        }
        return finish(out, 0.9f)
    }

    private fun synthSnare(): FloatArray {
        val n = (SAMPLE_RATE * 0.25).toInt()
        val out = FloatArray(n)
        for (i in 0 until n) {
            val t = i.toDouble() / SAMPLE_RATE
            val tone = sin(2 * PI * 185.0 * t) * exp(-t * 28.0) * 0.7
            val nz = noise() * exp(-t * 18.0) * 0.8
            out[i] = (tone + nz).toFloat()
        }
        return finish(out, 0.85f)
    }

    private fun synthHat(seconds: Double, decay: Double): FloatArray {
        val n = (SAMPLE_RATE * seconds).toInt()
        val out = FloatArray(n)
        var prev = 0f
        for (i in 0 until n) {
            val t = i.toDouble() / SAMPLE_RATE
            val x = noise()
            val hp = x - prev // prosty filtr górnoprzepustowy
            prev = x
            out[i] = (hp * exp(-t * decay)).toFloat()
        }
        return finish(out, 0.6f)
    }

    private fun synthClap(): FloatArray {
        val n = (SAMPLE_RATE * 0.25).toInt()
        val out = FloatArray(n)
        var prev = 0f
        for (i in 0 until n) {
            val t = i.toDouble() / SAMPLE_RATE
            val env = if (t < 0.03) exp(-(t % 0.01) * 400.0) else exp(-(t - 0.03) * 25.0)
            val x = noise()
            val y = x - 0.5f * prev
            prev = x
            out[i] = (y * env).toFloat()
        }
        return finish(out, 0.8f)
    }

    private fun synthTom(): FloatArray {
        val n = (SAMPLE_RATE * 0.4).toInt()
        val out = FloatArray(n)
        var phase = 0.0
        for (i in 0 until n) {
            val t = i.toDouble() / SAMPLE_RATE
            val freq = 100.0 + 120.0 * exp(-t * 20.0)
            phase += 2 * PI * freq / SAMPLE_RATE
            out[i] = (sin(phase) * exp(-t * 8.0)).toFloat()
        }
        return finish(out, 0.85f)
    }

    // ---------- pętle (1 takt) ----------

    private fun synthBeatLoop(kick: FloatArray, snare: FloatArray, hat: FloatArray): FloatArray {
        val out = FloatArray(BAR_FRAMES)
        for (b in 0 until 4) {
            if (b % 2 == 0) mixInto(out, kick, b * BEAT_FRAMES, 1f)
            else mixInto(out, snare, b * BEAT_FRAMES, 0.8f)
        }
        mixInto(out, kick, 5 * EIGHTH_FRAMES, 0.7f)
        for (e in 0 until 8) {
            mixInto(out, hat, e * EIGHTH_FRAMES, if (e % 2 == 1) 0.5f else 0.3f)
        }
        return normalize(out, 0.8f)
    }

    /** Four-on-the-floor: kick co ćwierćnutę, clap na 2 i 4, open hat na offbeatach. */
    private fun synthHouseLoop(kick: FloatArray, clap: FloatArray, openHat: FloatArray): FloatArray {
        val out = FloatArray(BAR_FRAMES)
        for (b in 0 until 4) mixInto(out, kick, b * BEAT_FRAMES, 1f)
        for (b in intArrayOf(1, 3)) mixInto(out, clap, b * BEAT_FRAMES, 0.7f)
        for (e in intArrayOf(1, 3, 5, 7)) mixInto(out, openHat, e * EIGHTH_FRAMES, 0.4f)
        return normalize(out, 0.8f)
    }

    private fun synthHats16Loop(hat: FloatArray): FloatArray {
        val out = FloatArray(BAR_FRAMES)
        for (k in 0 until 16) {
            val g = when (k % 4) {
                0 -> 0.35f
                2 -> 0.7f
                else -> 0.25f
            }
            mixInto(out, hat, k * BAR_FRAMES / 16, g)
        }
        return normalize(out, 0.7f)
    }

    private fun synthBassLoop(): FloatArray {
        val out = FloatArray(BAR_FRAMES)
        val notes = doubleArrayOf(55.0, 55.0, 82.41, 55.0, 65.41, 55.0, 73.42, 82.41)
        for ((idx, f) in notes.withIndex()) {
            val start = idx * EIGHTH_FRAMES
            var phase = 0.0
            for (i in 0 until EIGHTH_FRAMES) {
                val t = i.toDouble() / SAMPLE_RATE
                phase += 2 * PI * f / SAMPLE_RATE
                val tone = sin(phase) + 0.4 * sin(2 * phase) + 0.2 * sin(3 * phase)
                val attack = min(1.0, i / (SAMPLE_RATE * 0.004))
                val release = min(1.0, (EIGHTH_FRAMES - i) / (SAMPLE_RATE * 0.01))
                out[start + i] = (tone * exp(-t * 5.0) * attack * release).toFloat()
            }
        }
        return normalize(out, 0.8f)
    }

    /** Arpeggio 16-tych: Am przez pół taktu, potem F. */
    private fun synthArpLoop(): FloatArray {
        val out = FloatArray(BAR_FRAMES)
        val notes = doubleArrayOf(
            220.0, 261.63, 329.63, 440.0, 329.63, 261.63, 220.0, 261.63,
            174.61, 220.0, 261.63, 349.23, 261.63, 220.0, 174.61, 220.0,
        )
        for ((k, f) in notes.withIndex()) {
            val start = k * BAR_FRAMES / 16
            val len = (k + 1) * BAR_FRAMES / 16 - start
            var phase = 0.0
            for (i in 0 until len) {
                val t = i.toDouble() / SAMPLE_RATE
                phase += 2 * PI * f / SAMPLE_RATE
                var tone = 0.0
                for (h in 1..6) tone += sin(phase * h) / h // przybliżona piła
                val attack = min(1.0, i / (SAMPLE_RATE * 0.002))
                val release = min(1.0, (len - i) / (SAMPLE_RATE * 0.01))
                out[start + i] = (tone * exp(-t * 14.0) * attack * release).toFloat()
            }
        }
        return normalize(out, 0.7f)
    }

    /**
     * Akord Am (A2, A3, C4, E4) z lekkim detune. Częstotliwości dobrane tak, żeby w 2 s
     * mieściła się całkowita liczba okresów, więc pętla jest bez kliknięcia.
     */
    private fun synthChordLoop(): FloatArray {
        val out = FloatArray(BAR_FRAMES)
        val freqs = doubleArrayOf(110.0, 220.0, 261.5, 329.5)
        val detunes = doubleArrayOf(0.0, 0.5)
        val seconds = BAR_FRAMES.toDouble() / SAMPLE_RATE
        for (i in 0 until BAR_FRAMES) {
            val t = i.toDouble() / SAMPLE_RATE
            var s = 0.0
            for (f0 in freqs) for (d in detunes) {
                val w = 2 * PI * (f0 + d) * t
                s += sin(w) + 0.3 * sin(2 * w) + 0.12 * sin(3 * w)
            }
            out[i] = (s * (0.85 + 0.15 * sin(2 * PI * t / seconds))).toFloat()
        }
        return normalize(out, 0.55f)
    }

    private fun synthCowbell(): FloatArray {
        val n = (SAMPLE_RATE * 0.35).toInt()
        val out = FloatArray(n)
        for (i in 0 until n) {
            val t = i.toDouble() / SAMPLE_RATE
            val a = if (sin(2 * PI * 540.0 * t) >= 0.0) 1.0 else -1.0
            val b = if (sin(2 * PI * 810.0 * t) >= 0.0) 1.0 else -1.0
            val env = exp(-t * 11.0) * min(1.0, i / (SAMPLE_RATE * 0.001))
            out[i] = ((0.6 * a + 0.4 * b) * env).toFloat()
        }
        return finish(out, 0.55f)
    }

    private fun synthShakerLoop(): FloatArray {
        val hitLen = (SAMPLE_RATE * 0.09).toInt()
        val hit = FloatArray(hitLen)
        var prev = 0f
        for (i in 0 until hitLen) {
            val t = i.toDouble() / SAMPLE_RATE
            val x = noise()
            val hp = x - prev
            prev = x
            hit[i] = (hp * (1.0 - exp(-t * 900.0)) * exp(-t * 38.0)).toFloat()
        }
        normalize(hit, 0.6f)
        val out = FloatArray(BAR_FRAMES)
        for (k in 0 until 16) {
            val g = when (k % 4) {
                0 -> 0.45f
                2 -> 0.6f
                else -> 0.3f
            }
            mixInto(out, hit, k * BAR_FRAMES / 16, g)
        }
        return normalize(out, 0.55f)
    }

    // ---------- narzędzia ----------

    /** Miksuje [src] do [dst] od [offset]; ogon zawija się na początek (płynna pętla). */
    private fun mixInto(dst: FloatArray, src: FloatArray, offset: Int, gain: Float) {
        val n = dst.size
        for (i in src.indices) dst[(offset + i) % n] += src[i] * gain
    }

    private fun normalize(data: FloatArray, peak: Float): FloatArray {
        var m = 0f
        for (x in data) m = max(m, abs(x))
        if (m > 0f) {
            val k = peak / m
            for (i in data.indices) data[i] *= k
        }
        return data
    }

    /** Normalizacja + krótki fade-out na końcu, żeby uniknąć kliknięcia. */
    private fun finish(data: FloatArray, peak: Float): FloatArray {
        val fade = (SAMPLE_RATE * 0.005).toInt().coerceAtMost(data.size)
        for (i in 0 until fade) {
            data[data.size - 1 - i] *= i.toFloat() / fade
        }
        return normalize(data, peak)
    }
}
