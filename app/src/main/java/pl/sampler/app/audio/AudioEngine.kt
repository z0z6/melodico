package pl.sampler.app.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Process
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sign
import kotlin.math.tanh

/**
 * Prosty mikser: wątek audio sumuje aktywne głosy do bufora i zapisuje go do AudioTrack
 * (tryb LOW_LATENCY). Pętle są zsynchronizowane do wspólnego zegara, więc wszystkie
 * 1-taktowe pętle zawsze grają w fazie, niezależnie od momentu kliknięcia.
 */
class AudioEngine {

    val pads: List<Pad> = SynthPresets.buildPads()

    /** Id kafelków z włączoną pętlą (obserwowane przez Compose). Zmieniane tylko z wątku UI. */
    var activeLoops: Set<Int> by mutableStateOf(emptySet())
        private set

    private class Voice(
        val padId: Int,
        val data: FloatArray,
        val loop: Boolean,
        val gain: Float,
    ) {
        var position = 0
        var started = false
        @Volatile var stopping = false
        @Volatile var done = false
    }

    private val voices = CopyOnWriteArrayList<Voice>()
    private var clock = 0L // liczba wyrenderowanych ramek, dotykany tylko z wątku audio

    @Volatile private var running = false
    private var thread: Thread? = null

    // ---- API dla UI ----

    /** Wywoływane w momencie dotknięcia kafelka. */
    fun press(pad: Pad) {
        if (pad.loop) {
            toggleLoop(pad)
        } else if (voices.size < MAX_VOICES) {
            voices.add(Voice(pad.id, pad.data, loop = false, gain = GAIN))
        }
    }

    fun stopAll() {
        voices.forEach { it.stopping = true }
        activeLoops = emptySet()
    }

    @Synchronized
    fun start() {
        if (running) return
        val track = createTrack()
        running = true
        thread = Thread({ renderLoop(track) }, "audio-mixer").also { it.start() }
    }

    @Synchronized
    fun stop() {
        if (!running) return
        running = false
        thread?.join()
        thread = null
        voices.clear()
        activeLoops = emptySet()
    }

    // ---- wnętrze ----

    private fun toggleLoop(pad: Pad) {
        val playing = voices.filter { it.padId == pad.id && !it.stopping }
        if (playing.isNotEmpty()) {
            playing.forEach { it.stopping = true }
            activeLoops = activeLoops - pad.id
        } else {
            voices.add(Voice(pad.id, pad.data, loop = true, gain = GAIN))
            activeLoops = activeLoops + pad.id
        }
    }

    private fun createTrack(): AudioTrack {
        val minBytes = AudioTrack.getMinBufferSize(
            SynthPresets.SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_FLOAT,
        )
        val bufBytes = max(minBytes, CHUNK_FRAMES * 4 * 2)
        return AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(SynthPresets.SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
            .setBufferSizeInBytes(bufBytes)
            .build()
    }

    private fun renderLoop(track: AudioTrack) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val buf = FloatArray(CHUNK_FRAMES)
        track.play()
        while (running) {
            render(buf)
            track.write(buf, 0, buf.size, AudioTrack.WRITE_BLOCKING)
        }
        track.stop()
        track.release()
    }

    private fun render(buf: FloatArray) {
        val frames = buf.size
        buf.fill(0f)
        var anyDone = false

        for (v in voices) {
            if (v.done) continue
            val data = v.data
            var pos = v.position
            if (!v.started) {
                // pętla startuje w fazie ze wspólnym zegarem
                if (v.loop) pos = (clock % data.size).toInt()
                v.started = true
            }
            val fading = v.stopping
            var i = 0
            while (i < frames) {
                if (pos >= data.size) {
                    if (v.loop && !fading) {
                        pos = 0
                    } else {
                        v.done = true
                        break
                    }
                }
                var s = data[pos++] * v.gain
                if (fading) s *= 1f - i.toFloat() / frames // krótki fade-out przy zatrzymaniu
                buf[i] += s
                i++
            }
            v.position = pos
            if (fading) v.done = true
            if (v.done) anyDone = true
        }

        if (anyDone) voices.removeIf { it.done }
        for (i in 0 until frames) buf[i] = softClip(buf[i])
        clock += frames
    }

    /** Miękki limiter: liniowo do 0.7, powyżej łagodnie nasyca do 1.0. */
    private fun softClip(x: Float): Float {
        val a = abs(x)
        return if (a <= 0.7f) x else sign(x) * (0.7f + 0.3f * tanh((a - 0.7f) / 0.3f))
    }

    private companion object {
        const val CHUNK_FRAMES = 256
        const val MAX_VOICES = 32
        const val GAIN = 0.8f
    }
}
