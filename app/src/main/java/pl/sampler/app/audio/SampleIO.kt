package pl.sampler.app.audio

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.provider.OpenableColumns
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

object SampleProcessing {
    /** Usuwa DC, daje krótkie fade'y na brzegach (bez kliknięć) i normalizuje do ok. 0.9. */
    fun finish(data: FloatArray): FloatArray {
        val n = data.size
        if (n == 0) return data

        var sum = 0.0
        for (x in data) sum += x
        val mean = (sum / n).toFloat()
        for (i in 0 until n) data[i] -= mean

        val fade = min((SynthPresets.SAMPLE_RATE * 0.003).toInt(), n / 2)
        for (i in 0 until fade) {
            val g = i.toFloat() / fade
            data[i] *= g
            data[n - 1 - i] *= g
        }

        var peak = 0f
        for (x in data) peak = max(peak, abs(x))
        if (peak > 0.02f) {
            val k = 0.9f / peak
            for (i in 0 until n) data[i] *= k
        }
        return data
    }
}

/** Odbiorca zdekodowanych próbek mono (w częstotliwości źródła). */
interface MonoSink {
    fun onFormat(sampleRate: Int)

    /** Zwraca false, gdy odbiorca jest pełny, wtedy dekodowanie się kończy. */
    fun onSample(s: Float): Boolean
}

object AudioDecoder {

    private fun intOrDefault(f: MediaFormat, key: String, def: Int): Int =
        if (f.containsKey(key)) f.getInteger(key) else def

    /** Nazwa pliku bez rozszerzenia (do podpisu kafelka). */
    fun displayName(context: Context, uri: Uri): String? = try {
        context.contentResolver
            .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
            ?.substringBeforeLast('.')
    } catch (e: Exception) {
        null
    }

    /** Krótka próbka: mono float w SAMPLE_RATE, obcięta do [maxSeconds]. Wołać z wątku w tle. */
    fun decode(context: Context, uri: Uri, maxSeconds: Int): FloatArray? {
        val sink = ClipSink(maxSeconds)
        if (!decodeInto(context, uri, sink)) return null
        return sink.result()
    }

    /** Długi track (deck): mono 16-bit w SAMPLE_RATE, obcięty do [maxSeconds]. Wołać z wątku w tle. */
    fun decodeTrack(context: Context, uri: Uri, maxSeconds: Int): ShortArray? {
        val sink = TrackSink(maxSeconds)
        if (!decodeInto(context, uri, sink)) return null
        return sink.result()
    }

    /** Dekoduje plik i wpycha próbki mono do [sink]. Zwraca true, jeśli cokolwiek dostarczono. */
    private fun decodeInto(context: Context, uri: Uri, sink: MonoSink): Boolean {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        var delivered = false
        try {
            extractor.setDataSource(context, uri, null)

            var trackIndex = -1
            var format: MediaFormat? = null
            for (i in 0 until extractor.trackCount) {
                val f = extractor.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("audio/")) {
                    trackIndex = i
                    format = f
                    break
                }
            }
            if (trackIndex < 0 || format == null) return false
            extractor.selectTrack(trackIndex)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: return false

            var sampleRate = intOrDefault(format, MediaFormat.KEY_SAMPLE_RATE, 44100)
            var channels = max(1, intOrDefault(format, MediaFormat.KEY_CHANNEL_COUNT, 2))
            var pcmFloat = false
            sink.onFormat(sampleRate)

            val dec = MediaCodec.createDecoderByType(mime)
            codec = dec
            dec.configure(format, null, null, 0)
            dec.start()

            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            var full = false
            var idle = 0

            while (!outputDone && !full) {
                if (!inputDone) {
                    val inIdx = dec.dequeueInputBuffer(10_000)
                    if (inIdx >= 0) {
                        val inBuf = dec.getInputBuffer(inIdx)
                        val size = if (inBuf != null) extractor.readSampleData(inBuf, 0) else -1
                        if (size < 0) {
                            dec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            dec.queueInputBuffer(inIdx, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                val outIdx = dec.dequeueOutputBuffer(info, 10_000)
                if (outIdx >= 0) {
                    idle = 0
                    val out = dec.getOutputBuffer(outIdx)
                    if (out != null && info.size > 0) {
                        out.position(info.offset)
                        out.limit(info.offset + info.size)
                        out.order(ByteOrder.nativeOrder())
                        if (pcmFloat) {
                            val fb = out.asFloatBuffer()
                            val frames = fb.remaining() / channels
                            for (fr in 0 until frames) {
                                var s = 0f
                                for (c in 0 until channels) s += fb.get()
                                if (!sink.onSample(s / channels)) {
                                    full = true
                                    break
                                }
                                delivered = true
                            }
                        } else {
                            val sb = out.asShortBuffer()
                            val frames = sb.remaining() / channels
                            for (fr in 0 until frames) {
                                var s = 0f
                                for (c in 0 until channels) s += sb.get() / 32768f
                                if (!sink.onSample(s / channels)) {
                                    full = true
                                    break
                                }
                                delivered = true
                            }
                        }
                    }
                    dec.releaseOutputBuffer(outIdx, false)
                    if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true
                } else if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val nf = dec.outputFormat
                    sampleRate = intOrDefault(nf, MediaFormat.KEY_SAMPLE_RATE, sampleRate)
                    channels = max(1, intOrDefault(nf, MediaFormat.KEY_CHANNEL_COUNT, channels))
                    pcmFloat = intOrDefault(
                        nf, MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT
                    ) == AudioFormat.ENCODING_PCM_FLOAT
                    sink.onFormat(sampleRate)
                } else if (outIdx == MediaCodec.INFO_TRY_AGAIN_LATER && inputDone) {
                    idle++
                    if (idle > 300) break // zabezpieczenie przed zawieszeniem dekodera
                }
            }
            return delivered
        } catch (e: Exception) {
            return delivered // częściowo zdekodowany plik też się przyda
        } finally {
            try {
                codec?.stop()
            } catch (_: Exception) {
            }
            try {
                codec?.release()
            } catch (_: Exception) {
            }
            extractor.release()
        }
    }

    // ---------- sinki ----------

    /** Zbiera krótką próbkę w częstotliwości źródła, na końcu resampluje do SAMPLE_RATE. */
    private class ClipSink(private val maxSeconds: Int) : MonoSink {
        private var rate = 44100
        private var limit = 0
        private var buf = FloatArray(0)
        private var count = 0

        override fun onFormat(sampleRate: Int) {
            rate = sampleRate
            limit = sampleRate * maxSeconds
            if (buf.size < limit) buf = buf.copyOf(limit)
        }

        override fun onSample(s: Float): Boolean {
            if (count >= limit) return false
            buf[count++] = s
            return true
        }

        fun result(): FloatArray? {
            if (count == 0) return null
            val dstRate = SynthPresets.SAMPLE_RATE
            if (rate == dstRate) return buf.copyOf(count)
            val outLen = (count.toLong() * dstRate / rate).toInt()
            val out = FloatArray(outLen)
            val ratio = rate.toDouble() / dstRate
            for (i in 0 until outLen) {
                val p = i * ratio
                val i0 = p.toInt()
                val i1 = min(i0 + 1, count - 1)
                val f = (p - i0).toFloat()
                out[i] = buf[i0] * (1f - f) + buf[i1] * f
            }
            return out
        }
    }

    /** Strumieniowy resampler liniowy do SAMPLE_RATE, zapis 16-bit (oszczędza pamięć na długich trackach). */
    private class TrackSink(maxSeconds: Int) : MonoSink {
        private val dstRate = SynthPresets.SAMPLE_RATE
        private val limit = maxSeconds * dstRate
        private var out = ShortArray(min(limit, dstRate * 30))
        private var count = 0

        private var step = 1.0
        private var nextPos = 0.0
        private var index = 0L
        private var prev = 0f

        override fun onFormat(sampleRate: Int) {
            step = sampleRate.toDouble() / dstRate
        }

        override fun onSample(s: Float): Boolean {
            if (index > 0L) {
                val n = index.toDouble()
                while (nextPos < n) {
                    val frac = (nextPos - (n - 1.0)).toFloat()
                    if (!emit(prev + (s - prev) * frac)) return false
                    nextPos += step
                }
            }
            prev = s
            index++
            return true
        }

        private fun emit(v: Float): Boolean {
            if (count >= limit) return false
            if (count == out.size) out = out.copyOf(min(limit, out.size + out.size / 2))
            out[count++] = (v.coerceIn(-1f, 1f) * 32767f).toInt().toShort()
            return true
        }

        fun result(): ShortArray? = if (count < 2) null else out.copyOf(count)
    }
}
