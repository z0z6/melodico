package pl.sampler.app.audio

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/** Presety syntezowane w kodzie (bez plików i licencji). Pętle mają dokładnie 1 takt przy 120 BPM. */
object SynthPresets {
    const val SAMPLE_RATE = 44100
    private const val BPM = 120.0

    private val barFrames = (SAMPLE_RATE * 60.0 / BPM * 4).roundToInt() // 88200
    private val beatFrames = barFrames / 4
    private val eighthFrames = barFrames / 8

    private val rng = Random(1234)
    private fun noise(): Float = rng.nextFloat() * 2f - 1f

    fun buildPads(): List<Pad> {
        val kick = synthKick()
        val snare = synthSnare()
        val closedHat = synthHat(0.07, 60.0)
        val openHat = synthHat(0.35, 11.0)
        val clap = synthClap()
        val tom = synthTom()
        val beat = synthBeatLoop(kick, snare, closedHat)
        val bass = synthBassLoop()

        return listOf(
            Pad(0, "KICK", kick, false, 0xFFE53935),
            Pad(1, "SNARE", snare, false, 0xFFFB8C00),
            Pad(2, "HAT", closedHat, false, 0xFFFDD835),
            Pad(3, "OPEN HAT", openHat, false, 0xFF9CCC65),
            Pad(4, "CLAP", clap, false, 0xFF26A69A),
            Pad(5, "TOM", tom, false, 0xFF29B6F6),
            Pad(6, "BEAT", beat, true, 0xFF7E57C2),
            Pad(7, "BASS", bass, true, 0xFFEC407A),
        )
    }

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

    private fun synthBeatLoop(kick: FloatArray, snare: FloatArray, hat: FloatArray): FloatArray {
        val out = FloatArray(barFrames)
        for (b in 0 until 4) {
            if (b % 2 == 0) mixInto(out, kick, b * beatFrames, 1f)
            else mixInto(out, snare, b * beatFrames, 0.8f)
        }
        mixInto(out, kick, 5 * eighthFrames, 0.7f)
        for (e in 0 until 8) {
            mixInto(out, hat, e * eighthFrames, if (e % 2 == 1) 0.5f else 0.3f)
        }
        return normalize(out, 0.8f)
    }

    private fun synthBassLoop(): FloatArray {
        val out = FloatArray(barFrames)
        val notes = doubleArrayOf(55.0, 55.0, 82.41, 55.0, 65.41, 55.0, 73.42, 82.41)
        for ((idx, f) in notes.withIndex()) {
            val start = idx * eighthFrames
            var phase = 0.0
            for (i in 0 until eighthFrames) {
                val t = i.toDouble() / SAMPLE_RATE
                phase += 2 * PI * f / SAMPLE_RATE
                val tone = sin(phase) + 0.4 * sin(2 * phase) + 0.2 * sin(3 * phase)
                val attack = min(1.0, i / (SAMPLE_RATE * 0.004))
                val release = min(1.0, (eighthFrames - i) / (SAMPLE_RATE * 0.01))
                out[start + i] = (tone * exp(-t * 5.0) * attack * release).toFloat()
            }
        }
        return normalize(out, 0.8f)
    }

    private fun mixInto(dst: FloatArray, src: FloatArray, offset: Int, gain: Float) {
        val n = min(src.size, dst.size - offset)
        for (i in 0 until n) dst[offset + i] += src[i] * gain
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
