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

    /**
     * Dekoduje plik audio do mono float w SAMPLE_RATE, obcina do [maxSeconds].
     * Zwraca null, gdy się nie uda. Wołać z wątku w tle.
     */
    fun decode(context: Context, uri: Uri, maxSeconds: Int): FloatArray? {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
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
            if (trackIndex < 0 || format == null) return null
            extractor.selectTrack(trackIndex)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: return null

            var sampleRate = intOrDefault(format, MediaFormat.KEY_SAMPLE_RATE, 44100)
            var channels = max(1, intOrDefault(format, MediaFormat.KEY_CHANNEL_COUNT, 2))
            var pcmFloat = false

            val dec = MediaCodec.createDecoderByType(mime)
            codec = dec
            dec.configure(format, null, null, 0)
            dec.start()

            var limit = sampleRate * maxSeconds
            var mono = FloatArray(limit)
            var count = 0
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            var idle = 0

            while (!outputDone && count < limit) {
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
                                if (count < limit) mono[count++] = s / channels
                            }
                        } else {
                            val sb = out.asShortBuffer()
                            val frames = sb.remaining() / channels
                            for (fr in 0 until frames) {
                                var s = 0f
                                for (c in 0 until channels) s += sb.get() / 32768f
                                if (count < limit) mono[count++] = s / channels
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
                    val newLimit = sampleRate * maxSeconds
                    if (newLimit > mono.size) mono = mono.copyOf(newLimit)
                    limit = newLimit
                } else if (outIdx == MediaCodec.INFO_TRY_AGAIN_LATER && inputDone) {
                    idle++
                    if (idle > 300) break // zabezpieczenie przed zawieszeniem dekodera
                }
            }

            if (count == 0) return null
            return resample(mono, count, sampleRate)
        } catch (e: Exception) {
            return null
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

    private fun resample(src: FloatArray, count: Int, srcRate: Int): FloatArray {
        val dstRate = SynthPresets.SAMPLE_RATE
        if (srcRate == dstRate) return src.copyOf(count)
        val outLen = (count.toLong() * dstRate / srcRate).toInt()
        val out = FloatArray(outLen)
        val ratio = srcRate.toDouble() / dstRate
        for (i in 0 until outLen) {
            val p = i * ratio
            val i0 = p.toInt()
            val i1 = min(i0 + 1, count - 1)
            val f = (p - i0).toFloat()
            out[i] = src[i0] * (1f - f) + src[i1] * f
        }
        return out
    }
}
