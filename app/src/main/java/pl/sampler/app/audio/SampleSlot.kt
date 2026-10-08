package pl.sampler.app.audio

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

enum class SlotStatus { EMPTY, RECORDING, LOADING, READY }

/** Slot na własny dźwięk (nagranie z mikrofonu lub plik). Modyfikowany wyłącznie z wątku UI. */
class SampleSlot(val index: Int) {
    val padId: Int = PAD_ID_BASE + index

    /** Próbki mono w SynthPresets.SAMPLE_RATE; stan UI odzwierciedla [status]. */
    var data: FloatArray? = null
    var status by mutableStateOf(SlotStatus.EMPTY)
    var loop by mutableStateOf(false)
    var seconds by mutableStateOf(0f)
    var name by mutableStateOf("")

    companion object {
        const val PAD_ID_BASE = 100
    }
}
