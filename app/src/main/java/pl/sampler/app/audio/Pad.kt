package pl.sampler.app.audio

/** Jeden kafelek z gotowym dźwiękiem. [data] to mono float -1..1 w SynthPresets.SAMPLE_RATE. */
class Pad(
    val id: Int,
    val label: String,
    val data: FloatArray,
    val loop: Boolean,
    val colorArgb: Long,
)
