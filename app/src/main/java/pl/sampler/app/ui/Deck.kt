package pl.sampler.app.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin
import pl.sampler.app.audio.AudioEngine
import pl.sampler.app.audio.SlotStatus
import pl.sampler.app.audio.SynthPresets

// położenie i rozmiar talerza w kwadratowym canvasie (tonearm ma miejsce w prawym górnym rogu)
private const val PLATTER_CX = 0.45f
private const val PLATTER_CY = 0.53f
private const val PLATTER_R = 0.42f
private val TWO_PI = (2.0 * PI).toFloat()

private fun fmtTime(totalSeconds: Int): String =
    String.format(Locale.US, "%d:%02d", totalSeconds / 60, totalSeconds % 60)

/**
 * Deck winylowy: płyta obraca się zgodnie z pozycją w tracku. Dotknięcie płyty ją zatrzymuje,
 * a przesuwanie palca po okręgu to scratch (do przodu i do tyłu). Puszczenie = powrót do obrotów silnika.
 */
@Composable
fun DeckPanel(
    engine: AudioEngine,
    onLoad: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val accent = ConsoleColors.Cyan

    var posFrames by remember { mutableDoubleStateOf(0.0) }
    var playing by remember { mutableStateOf(false) }
    var loopOn by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        while (true) {
            withFrameNanos {
                posFrames = engine.deckPosFrames
                playing = engine.deckPlaying
                loopOn = engine.deckLoop
            }
        }
    }

    val status = engine.deckStatus
    val lenFrames = engine.deckLengthFrames
    val sr = SynthPresets.SAMPLE_RATE
    val curSec by remember { derivedStateOf { (posFrames / sr).toInt() } }
    val timeText = fmtTime(curSec) + " / " + fmtTime(lenFrames / sr)

    val lower by animateFloatAsState(if (playing) 1f else 0f, tween(450), label = "arm")

    var pitchUi by remember { mutableStateOf(0.5f) }
    var volUi by remember { mutableStateOf(0.8f) }
    val pitchPct = (pitchUi - 0.5f) * 2f * 16f

    Column(
        modifier
            .consolePanel()
            .padding(6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        // nagłówek
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "DECK A",
                color = ConsoleColors.Amber,
                fontFamily = ConsoleFont,
                fontWeight = FontWeight.Bold,
                fontSize = 9.sp,
                letterSpacing = 1.sp,
            )
            Text(
                if (engine.deckName.isEmpty()) "NO TRACK" else engine.deckName,
                modifier = Modifier.weight(1f),
                color = Color.White.copy(alpha = 0.85f),
                fontFamily = ConsoleFont,
                fontSize = 9.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                timeText,
                color = accent,
                fontFamily = ConsoleFont,
                fontWeight = FontWeight.Bold,
                fontSize = 9.sp,
                maxLines = 1,
            )
        }

        // talerz
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            Canvas(
                Modifier
                    .fillMaxHeight()
                    .aspectRatio(1f, matchHeightConstraintsFirst = true)
                    .pointerInput(status) {
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            if (status != SlotStatus.READY) return@awaitEachGesture
                            val cx = size.width * PLATTER_CX
                            val cy = size.height * PLATTER_CY
                            val radius = min(size.width, size.height) * PLATTER_R
                            val dx0 = down.position.x - cx
                            val dy0 = down.position.y - cy
                            if (hypot(dx0, dy0) > radius * 1.05f) return@awaitEachGesture

                            engine.deckTouch(true)
                            try {
                                var last = atan2(dy0, dx0)
                                down.consume()
                                while (true) {
                                    val event = awaitPointerEvent()
                                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                    if (!change.pressed) break
                                    val a = atan2(change.position.y - cy, change.position.x - cx)
                                    var d = a - last
                                    if (d > PI.toFloat()) d -= TWO_PI else if (d < -PI.toFloat()) d += TWO_PI
                                    engine.deckScratch(d.toDouble() / TWO_PI)
                                    last = a
                                    change.consume()
                                }
                            } finally {
                                engine.deckTouch(false)
                            }
                        }
                    }
            ) {
                val s = min(size.width, size.height)
                val c = Offset(size.width * PLATTER_CX, size.height * PLATTER_CY)
                val r = s * PLATTER_R
                val angle = ((posFrames / AudioEngine.DECK_FRAMES_PER_REV) * 360.0 % 360.0).toFloat()
                val prog = if (lenFrames > 0) (posFrames / lenFrames).coerceIn(0.0, 1.0).toFloat() else 0f

                // cień i talerz
                drawCircle(Color.Black.copy(alpha = 0.45f), r * 1.06f, c + Offset(0f, 3.dp.toPx()))
                drawCircle(
                    Brush.verticalGradient(
                        listOf(Color(0xFF3A3F4A), Color(0xFF1A1C21)),
                        startY = c.y - r, endY = c.y + r,
                    ),
                    r * 1.03f, c,
                )

                // znaczniki strobo na obrzeżu, obracają się razem z płytą
                rotate(angle, c) {
                    for (i in 0 until 72) {
                        val a = i * 2.0 * PI / 72.0
                        val ca = cos(a).toFloat()
                        val sa = sin(a).toFloat()
                        val major = i % 6 == 0
                        drawLine(
                            Color(0xFF8A93A3).copy(alpha = if (major) 0.9f else 0.45f),
                            Offset(c.x + ca * r * (if (major) 0.955f else 0.97f), c.y + sa * r * (if (major) 0.955f else 0.97f)),
                            Offset(c.x + ca * r * 1.01f, c.y + sa * r * 1.01f),
                            strokeWidth = 1.2.dp.toPx(),
                        )
                    }
                }

                // płyta i rowki
                drawCircle(Color(0xFF08090C), r * 0.94f, c)
                for (i in 0..11) {
                    drawCircle(
                        Color.White.copy(alpha = if (i % 4 == 0) 0.10f else 0.04f),
                        r * (0.40f + 0.045f * i), c, style = Stroke(1f),
                    )
                }

                // neonowa krawędź (mocniej, gdy gra)
                val glowA = 0.25f + 0.55f * lower
                drawCircle(accent.copy(alpha = glowA * 0.35f), r * 0.945f, c, style = Stroke(5.dp.toPx()))
                drawCircle(accent.copy(alpha = glowA), r * 0.945f, c, style = Stroke(1.5.dp.toPx()))

                // etykieta (obraca się)
                rotate(angle, c) {
                    drawCircle(
                        Brush.linearGradient(
                            listOf(Color(0xFFFF2D95), Color(0xFF7C4DFF)),
                            start = Offset(c.x - r * 0.3f, c.y - r * 0.3f),
                            end = Offset(c.x + r * 0.3f, c.y + r * 0.3f),
                        ),
                        r * 0.31f, c,
                    )
                    drawArc(
                        Color.White.copy(alpha = 0.85f), startAngle = -105f, sweepAngle = 45f, useCenter = false,
                        topLeft = Offset(c.x - r * 0.22f, c.y - r * 0.22f), size = Size(r * 0.44f, r * 0.44f),
                        style = Stroke(r * 0.03f, cap = StrokeCap.Round),
                    )
                    drawCircle(Color.White.copy(alpha = 0.9f), r * 0.025f, Offset(c.x, c.y - r * 0.27f))
                }
                drawCircle(Color(0xFF08090C), r * 0.04f, c)

                // połysk (nieruchomy)
                drawCircle(
                    Brush.sweepGradient(
                        0f to Color.Transparent,
                        0.07f to Color.White.copy(alpha = 0.11f),
                        0.14f to Color.Transparent,
                        0.5f to Color.Transparent,
                        0.57f to Color.White.copy(alpha = 0.11f),
                        0.64f to Color.Transparent,
                        1f to Color.Transparent,
                        center = c,
                    ),
                    r * 0.94f, c,
                )

                // ramię: spoczynek -> opuszczone, przesuwa się do środka wraz z postępem tracka
                val pivot = Offset(size.width * 0.93f, size.height * 0.10f)
                val armLen = s * 0.66f
                val a0 = 80f
                val a1 = 105f + 20f * prog
                val ang = (a0 + (a1 - a0) * lower) * (PI / 180.0)
                val tip = Offset(
                    pivot.x + armLen * cos(ang).toFloat(),
                    pivot.y + armLen * sin(ang).toFloat(),
                )
                val sh = Offset(2.dp.toPx(), 3.dp.toPx())
                drawLine(Color.Black.copy(alpha = 0.35f), pivot + sh, tip + sh, 3.dp.toPx(), StrokeCap.Round)
                drawLine(Color(0xFFC7CCD6), pivot, tip, 2.5.dp.toPx(), StrokeCap.Round)
                drawCircle(Color(0xFFFF9100), 3.5.dp.toPx(), tip)
                drawCircle(Color(0xFF2A2D34), 9.dp.toPx(), pivot)
                drawCircle(Color(0xFF8A93A3), 4.dp.toPx(), pivot)
            }

            if (status != SlotStatus.READY) {
                Text(
                    if (status == SlotStatus.LOADING) "LOADING TRACK..." else "LOAD A TRACK",
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .background(Color(0xAA000000), RoundedCornerShape(4.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                    color = ConsoleColors.Label,
                    fontFamily = ConsoleFont,
                    fontWeight = FontWeight.Bold,
                    fontSize = 9.sp,
                    letterSpacing = 1.sp,
                )
            }
        }

        // przyciski transportu
        Row(
            Modifier.fillMaxWidth().height(26.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            ConsoleButton(
                "LOAD", ConsoleColors.Amber, status == SlotStatus.LOADING,
                Modifier.weight(1f).fillMaxHeight(),
            ) { onLoad() }
            ConsoleButton(
                if (playing) "PAUSE" else "PLAY", ConsoleColors.Green, playing,
                Modifier.weight(1f).fillMaxHeight(),
            ) { engine.deckTogglePlay() }
            ConsoleButton("CUE", accent, false, Modifier.weight(1f).fillMaxHeight()) { engine.deckCue() }
            ConsoleButton("LOOP", ConsoleColors.Green, loopOn, Modifier.weight(1f).fillMaxHeight()) {
                engine.deckToggleLoop()
            }
        }

        // fadery
        HFader(
            label = "PITCH",
            readout = String.format(Locale.US, "%+.1f%%", pitchPct),
            value = pitchUi,
            color = ConsoleColors.Amber,
            centerDetent = true,
            modifier = Modifier.fillMaxWidth(),
            onChange = {
                pitchUi = it
                engine.deckSetPitch((it - 0.5f) * 2f * 16f)
            },
        )
        HFader(
            label = "VOL",
            readout = "${(volUi * 100).toInt()}%",
            value = volUi,
            color = accent,
            modifier = Modifier.fillMaxWidth(),
            onChange = {
                volUi = it
                engine.deckSetVolume(it)
            },
        )
        Spacer(Modifier.height(0.dp))
    }
}
