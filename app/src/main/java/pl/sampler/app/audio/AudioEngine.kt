package pl.sampler.app.audio

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.widget.Toast
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sign
import kotlin.math.tanh

/**
 * Mikser audio.
 *
 * - One-shoty: odtwarzanie z interpolacją; tonacja zmienia prędkość (jak winyl).
 * - Pętle: granularny time-stretch + pitch-shift (dwa nakładające się ziarna z oknem Hanna),
 *   dzięki czemu TEMPO i TONACJA działają niezależnie. Przy 120 BPM i tonacji 0 wynik jest
 *   identyczny z oryginałem. Pętle presetów są zsynchronizowane do wspólnego zegara.
 * - Deck winylowy: długi track (16-bit mono) odtwarzany z płynną prędkością. Dotknięcie płyty
 *   przejmuje kontrolę nad pozycją (scratch), puszczenie przywraca obroty silnika z bezwładnością.
 */
class AudioEngine {

    val pads: List<Pad> = SynthPresets.buildPads()
    val slots: List<SampleSlot> = List(4) { SampleSlot(it) }

    /** Id kafelków z aktualnie grającą pętlą (obserwowane przez Compose). Tylko wątek UI. */
    var activeLoops: Set<Int> by mutableStateOf(emptySet())
        private set

    /** Id kafelków w trybie pętli (przełączane podwójnym kliknięciem). Tylko wątek UI. */
    var loopModes: Set<Int> by mutableStateOf(pads.filter { it.loop }.map { it.id }.toSet())
        private set

    /** Szczytowy poziom ostatniego bloku (do wskaźnika wysterowania). */
    @Volatile
    var levelPeak: Float = 0f
        private set

    @Volatile private var tempoRatio = 1.0
    @Volatile private var pitchRatio = 1.0

    private class Voice(
        val padId: Int,
        val data: FloatArray,
        val loop: Boolean,
        val gain: Float,
        val syncMaster: Boolean,
    ) {
        // one-shot
        var pos = 0.0

        // pętla (granularnie)
        var contentPos = 0.0
        val gPos = DoubleArray(2)
        val gAge = IntArray(2)
        var started = false
        var fadeIn = 0

        @Volatile var stopping = false
        @Volatile var done = false
    }

    private val voices = CopyOnWriteArrayList<Voice>()
    private var masterPos = 0.0 // dotykany tylko z wątku audio

    @Volatile private var running = false
    private var thread: Thread? = null

    private val main = Handler(Looper.getMainLooper())

    private val hann = FloatArray(GRAIN) {
        (0.5 * (1.0 - cos(2.0 * PI * it / GRAIN))).toFloat()
    }

    // ================= odtwarzanie kafelków =================

    fun setTempo(ratio: Double) {
        tempoRatio = ratio.coerceIn(0.25, 4.0)
    }

    fun setPitch(ratio: Double) {
        pitchRatio = ratio.coerceIn(0.25, 4.0)
    }

    /** Dotknięcie kafelka presetu: w trybie pętli włącza/wyłącza pętlę, inaczej odpala jednorazowo. */
    fun press(pad: Pad) {
        if (pad.id in loopModes) toggleLoop(pad.id, pad.data, syncMaster = true)
        else addOneShot(pad.id, pad.data)
    }

    /** Podwójne kliknięcie: przełącza tryb kafelka (one-shot / pętla). Przejście na pętlę od razu ją startuje. */
    fun toggleLoopMode(pad: Pad) {
        stopVoices(pad.id)
        val nowLoop = pad.id !in loopModes
        loopModes = if (nowLoop) loopModes + pad.id else loopModes - pad.id
        if (nowLoop) toggleLoop(pad.id, pad.data, syncMaster = true)
    }

    fun pressSlot(slot: SampleSlot) {
        val d = slot.data ?: return
        if (slot.status != SlotStatus.READY) return
        if (slot.loop) toggleLoop(slot.padId, d, syncMaster = false)
        else addOneShot(slot.padId, d)
    }

    fun toggleSlotLoopMode(slot: SampleSlot) {
        val d = slot.data ?: return
        if (slot.status != SlotStatus.READY) return
        stopVoices(slot.padId)
        slot.loop = !slot.loop
        if (slot.loop) toggleLoop(slot.padId, d, syncMaster = false)
    }

    fun clearSlot(slot: SampleSlot) {
        if (slot.status == SlotStatus.RECORDING || slot.status == SlotStatus.LOADING) return
        stopVoices(slot.padId)
        slot.data = null
        slot.name = ""
        slot.loop = false
        slot.status = SlotStatus.EMPTY
    }

    fun stopAll() {
        voices.forEach { it.stopping = true }
        activeLoops = emptySet()
        dPlayFlag = false
    }

    @Synchronized
    fun start() {
        if (running) return
        val track = createTrack()
        running = true
        thread = Thread({ audioThreadMain(track) }, "audio-mixer").also { it.start() }
    }

    @Synchronized
    fun stop() {
        stopRecordingBlocking()
        dPlayFlag = false
        dTouching = false
        if (!running) return
        running = false
        thread?.join()
        thread = null
        voices.clear()
        activeLoops = emptySet()
    }

    // ================= deck winylowy =================

    @Volatile private var dData: ShortArray? = null
    @Volatile private var dPlayFlag = false
    @Volatile private var dTouching = false
    @Volatile private var dTarget = 0.0
    @Volatile private var dPitch = 1.0
    @Volatile private var dVol = 0.8
    @Volatile private var dLoop = false
    @Volatile private var dSeek = -1.0

    private var dPos = 0.0  // tylko wątek audio
    private var dRate = 0.0 // tylko wątek audio

    var deckStatus by mutableStateOf(SlotStatus.EMPTY)
        private set
    var deckName by mutableStateOf("")
        private set

    @Volatile var deckPosFrames: Double = 0.0
        private set
    @Volatile var deckLengthFrames: Int = 0
        private set

    val deckPlaying: Boolean get() = dPlayFlag
    val deckLoop: Boolean get() = dLoop

    /** Wczytuje track (max [DECK_MAX_SECONDS] s, mono) na deck. */
    fun loadDeck(context: Context, uri: Uri) {
        if (deckStatus == SlotStatus.LOADING) return
        dPlayFlag = false
        deckStatus = SlotStatus.LOADING
        val app = context.applicationContext
        Thread({
            val data = AudioDecoder.decodeTrack(app, uri, DECK_MAX_SECONDS)
            val name = AudioDecoder.displayName(app, uri) ?: "TRACK"
            main.post {
                if (data == null || data.size < MIN_SAMPLE_FRAMES) {
                    Toast.makeText(app, "Nie udało się wczytać tracka", Toast.LENGTH_SHORT).show()
                    deckStatus = if (dData != null) SlotStatus.READY else SlotStatus.EMPTY
                } else {
                    dPlayFlag = false
                    dData = data
                    deckLengthFrames = data.size
                    dSeek = 0.0
                    deckPosFrames = 0.0
                    deckName = name
                    deckStatus = SlotStatus.READY
                }
            }
        }, "deck-loader").start()
    }

    fun deckTogglePlay() {
        if (dData == null || deckStatus != SlotStatus.READY) return
        if (!dPlayFlag && deckPosFrames >= deckLengthFrames - 2) dSeek = 0.0
        dPlayFlag = !dPlayFlag
    }

    /** CUE: zatrzymuje i wraca na początek tracka. */
    fun deckCue() {
        if (dData == null) return
        dPlayFlag = false
        dSeek = 0.0
    }

    fun deckToggleLoop() {
        dLoop = !dLoop
    }

    /** Fader pitch w procentach (np. -16..+16). */
    fun deckSetPitch(percent: Float) {
        dPitch = 1.0 + percent / 100.0
    }

    fun deckSetVolume(v: Float) {
        dVol = v.coerceIn(0f, 1f).toDouble()
    }

    /** Palec dotyka płyty (true) lub ją puszcza (false). */
    fun deckTouch(down: Boolean) {
        if (down) {
            dTarget = deckPosFrames
            dTouching = dData != null
        } else {
            dTouching = false
        }
    }

    /** Obrót płyty o [revolutions] obrotów (dodatnio = zgodnie z ruchem wskazówek zegara = do przodu). */
    fun deckScratch(revolutions: Double) {
        if (!dTouching) return
        val len = deckLengthFrames
        dTarget = (dTarget + revolutions * DECK_FRAMES_PER_REV).coerceIn(0.0, max(0, len - 1).toDouble())
    }

    // ================= nagrywanie i pliki =================

    private var recordThread: Thread? = null
    @Volatile private var recordStop = false

    /** Start nagrywania z mikrofonu do slotu (max [MAX_SECONDS] s). Wymaga zgody RECORD_AUDIO. */
    fun startRecording(context: Context, slot: SampleSlot) {
        if (slot.status == SlotStatus.LOADING) return
        stopRecordingBlocking()
        stopVoices(slot.padId)
        slot.status = SlotStatus.RECORDING
        slot.seconds = 0f
        recordStop = false
        val app = context.applicationContext
        recordThread = Thread({ recordLoop(app, slot) }, "recorder").also { it.start() }
    }

    /** Kończy nagrywanie (wynik trafi do slotu asynchronicznie). */
    fun stopRecording() {
        recordStop = true
    }

    private fun stopRecordingBlocking() {
        recordStop = true
        recordThread?.join()
        recordThread = null
    }

    /** Wczytuje plik audio do slotu (obcina do [MAX_SECONDS] s). */
    fun loadFile(context: Context, slot: SampleSlot, uri: Uri) {
        if (slot.status == SlotStatus.RECORDING || slot.status == SlotStatus.LOADING) return
        stopVoices(slot.padId)
        slot.status = SlotStatus.LOADING
        val app = context.applicationContext
        Thread({
            val raw = AudioDecoder.decode(app, uri, MAX_SECONDS)
            val name = AudioDecoder.displayName(app, uri) ?: "PLIK"
            val result = raw?.let { SampleProcessing.finish(it) }
            main.post {
                if (result == null || result.size < MIN_SAMPLE_FRAMES) {
                    Toast.makeText(app, "Nie udało się wczytać pliku", Toast.LENGTH_SHORT).show()
                }
                completeSlot(slot, result, name)
            }
        }, "sample-loader").start()
    }

    // ================= wnętrze: głosy =================

    private fun addOneShot(padId: Int, data: FloatArray) {
        if (voices.size < MAX_VOICES) {
            voices.add(Voice(padId, data, loop = false, gain = GAIN, syncMaster = false))
        }
    }

    private fun toggleLoop(padId: Int, data: FloatArray, syncMaster: Boolean) {
        val playing = voices.filter { it.padId == padId && !it.stopping }
        if (playing.isNotEmpty()) {
            playing.forEach { it.stopping = true }
            activeLoops = activeLoops - padId
        } else {
            voices.add(Voice(padId, data, loop = true, gain = GAIN, syncMaster = syncMaster))
            activeLoops = activeLoops + padId
        }
    }

    private fun stopVoices(padId: Int) {
        voices.forEach { if (it.padId == padId) it.stopping = true }
        activeLoops = activeLoops - padId
    }

    private fun completeSlot(slot: SampleSlot, result: FloatArray?, name: String) {
        if (result != null && result.size >= MIN_SAMPLE_FRAMES) {
            slot.data = result
            slot.name = name
            slot.status = SlotStatus.READY
        } else {
            slot.status = if (slot.data != null) SlotStatus.READY else SlotStatus.EMPTY
        }
    }

    @SuppressLint("MissingPermission")
    private fun recordLoop(app: Context, slot: SampleSlot) {
        val sr = SynthPresets.SAMPLE_RATE
        val maxFrames = sr * MAX_SECONDS
        val minBytes = AudioRecord.getMinBufferSize(
            sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
        )
        val rec = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC, sr,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                max(minBytes, 8192),
            )
        } catch (e: Exception) {
            null
        }

        var started = false
        if (rec != null && rec.state == AudioRecord.STATE_INITIALIZED) {
            try {
                rec.startRecording()
                started = rec.recordingState == AudioRecord.RECORDSTATE_RECORDING
            } catch (e: Exception) {
                started = false
            }
        }
        if (rec == null || !started) {
            rec?.release()
            main.post {
                Toast.makeText(app, "Nie można uruchomić mikrofonu", Toast.LENGTH_SHORT).show()
                completeSlot(slot, null, "")
            }
            return
        }

        val data = FloatArray(maxFrames)
        val chunk = ShortArray(1024)
        var count = 0
        while (!recordStop && count < maxFrames) {
            val n = rec.read(chunk, 0, min(chunk.size, maxFrames - count))
            if (n <= 0) break
            for (i in 0 until n) data[count + i] = chunk[i] / 32768f
            count += n
            val secs = count.toFloat() / sr
            main.post { slot.seconds = secs }
        }
        try {
            rec.stop()
        } catch (_: Exception) {
        }
        rec.release()

        val result = if (count > 0) SampleProcessing.finish(data.copyOf(count)) else null
        val name = String.format(Locale.US, "MIC %.1fs", count.toFloat() / sr)
        main.post { completeSlot(slot, result, name) }
    }

    // ================= wątek audio =================

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

    private fun audioThreadMain(track: AudioTrack) {
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
        val tempo = tempoRatio
        val pitch = pitchRatio
        buf.fill(0f)
        var anyDone = false

        for (v in voices) {
            if (v.done) continue
            if (v.loop) mixLoop(v, buf, frames, tempo, pitch)
            else mixOneShot(v, buf, frames, pitch)
            if (v.done) anyDone = true
        }
        if (anyDone) voices.removeIf { it.done }

        mixDeck(buf, frames)

        var peak = 0f
        for (i in 0 until frames) {
            val y = softClip(buf[i])
            buf[i] = y
            peak = max(peak, abs(y))
        }
        levelPeak = peak
        masterPos = (masterPos + tempo * frames) % MASTER_WRAP
    }

    private fun mixOneShot(v: Voice, buf: FloatArray, frames: Int, pitch: Double) {
        val data = v.data
        val n = data.size
        val fading = v.stopping
        var p = v.pos
        for (i in 0 until frames) {
            val i0 = p.toInt()
            if (i0 >= n - 1) {
                v.done = true
                break
            }
            val f = (p - i0).toFloat()
            var s = (data[i0] * (1f - f) + data[i0 + 1] * f) * v.gain
            if (fading) s *= 1f - i.toFloat() / frames
            buf[i] += s
            p += pitch
        }
        v.pos = p
        if (fading) v.done = true
    }

    private fun mixLoop(v: Voice, buf: FloatArray, frames: Int, tempo: Double, pitch: Double) {
        val data = v.data
        val n = data.size
        val nd = n.toDouble()

        if (!v.started) {
            v.contentPos = if (v.syncMaster) masterPos % nd else 0.0
            // grain 0 jest w szczycie okna, grain 1 dopiero startuje: suma okien = 1
            v.gPos[0] = v.contentPos
            v.gAge[0] = HOP
            v.gPos[1] = v.contentPos
            v.gAge[1] = 0
            v.fadeIn = FADE_IN
            v.started = true
        }

        val fading = v.stopping
        for (i in 0 until frames) {
            var acc = 0f
            for (g in 0..1) {
                var p = v.gPos[g]
                val i0 = p.toInt()
                val i1 = if (i0 + 1 >= n) 0 else i0 + 1
                val f = (p - i0).toFloat()
                acc += (data[i0] * (1f - f) + data[i1] * f) * hann[v.gAge[g]]

                p += pitch
                if (p >= nd) p -= nd
                v.gPos[g] = p

                val age = v.gAge[g] + 1
                if (age >= GRAIN) {
                    // nowy grain startuje w miejscu, które zegar treści osiągnie w następnej próbce
                    var np = v.contentPos + tempo
                    if (np >= nd) np -= nd
                    v.gPos[g] = np
                    v.gAge[g] = 0
                } else {
                    v.gAge[g] = age
                }
            }
            v.contentPos += tempo
            if (v.contentPos >= nd) v.contentPos -= nd

            var s = acc * v.gain
            if (v.fadeIn > 0) {
                s *= 1f - v.fadeIn.toFloat() / FADE_IN
                v.fadeIn--
            }
            if (fading) s *= 1f - i.toFloat() / frames
            buf[i] += s
        }
        if (fading) v.done = true
    }

    /** Deck: płynna prędkość odtwarzania + scratch sterowany pozycją palca. */
    private fun mixDeck(buf: FloatArray, frames: Int) {
        val data = dData ?: return
        val len = data.size
        if (len < 2) return

        val seek = dSeek
        if (seek >= 0.0) {
            dPos = seek.coerceIn(0.0, len - 1.0)
            dSeek = -1.0
            dRate = 0.0
            deckPosFrames = dPos
        }

        val touching = dTouching
        val playFlag = dPlayFlag
        val loop = dLoop
        val vol = dVol.toFloat()
        val startRate = dRate

        val endRate = if (touching) {
            // płyta podąża za palcem; wygładzanie na kilka bloków usuwa "schodki" ze zdarzeń dotyku
            ((dTarget - dPos) / (frames * SCRATCH_SMOOTH)).coerceIn(-MAX_SCRATCH_RATE, MAX_SCRATCH_RATE)
        } else {
            // silnik: rozpędza się szybko, hamuje wolniej (bezwładność talerza)
            val motor = if (playFlag) dPitch else 0.0
            val tau = if (playFlag) 0.10 else 0.30
            startRate + (motor - startRate) * (1.0 - exp(-frames / (SynthPresets.SAMPLE_RATE * tau)))
        }

        var pos = dPos
        var ended = false
        for (i in 0 until frames) {
            val k = (i + 1).toDouble() / frames
            val rate = startRate + (endRate - startRate) * k
            val i0 = pos.toInt()
            if (i0 >= 0 && i0 < len - 1) {
                val f = (pos - i0).toFloat()
                val s = (data[i0] * (1f - f) + data[i0 + 1] * f) / 32768f
                // przy zatrzymanej płycie sygnał gaśnie (bez stałej składowej)
                val amp = min(1f, abs(rate).toFloat() * 6f)
                buf[i] += s * vol * amp * DECK_GAIN
            }
            pos += rate
            if (pos >= len - 1.0) {
                if (loop && !touching) {
                    pos -= (len - 1.0)
                } else {
                    pos = len - 1.0
                    if (!touching) {
                        ended = true
                        break
                    }
                }
            } else if (pos < 0.0) {
                pos = 0.0
            }
        }
        dPos = pos
        dRate = if (ended) 0.0 else endRate
        deckPosFrames = pos
        if (ended) dPlayFlag = false
    }

    /** Miękki limiter: liniowo do 0.7, powyżej łagodnie nasyca do 1.0. */
    private fun softClip(x: Float): Float {
        val a = abs(x)
        return if (a <= 0.7f) x else sign(x) * (0.7f + 0.3f * tanh((a - 0.7f) / 0.3f))
    }

    companion object {
        /** Maksymalna długość nagrania / wczytanego pliku na kafelku REC (s). */
        const val MAX_SECONDS = 10

        /** Maksymalna długość tracka na decku (s). */
        const val DECK_MAX_SECONDS = 360

        /** Liczba próbek na jeden obrót płyty 33 1/3 obr./min. */
        const val DECK_FRAMES_PER_REV = 79380.0

        private const val CHUNK_FRAMES = 256
        private const val MAX_VOICES = 32
        private const val GAIN = 0.8f
        private const val DECK_GAIN = 0.85f
        private const val GRAIN = 2048
        private const val HOP = GRAIN / 2
        private const val FADE_IN = 128
        private const val MIN_SAMPLE_FRAMES = 4410 // 0.1 s
        private const val MAX_SCRATCH_RATE = 8.0
        private const val SCRATCH_SMOOTH = 3.0
        private val MASTER_WRAP = SynthPresets.BAR_FRAMES * 8.0
    }
}
