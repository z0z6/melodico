package pl.sampler.app.ui

import android.os.SystemClock
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.max

/** Maksymalny odstęp między dwoma dotknięciami, żeby liczyły się jako podwójne kliknięcie. */
private const val DOUBLE_TAP_MS = 280L

/**
 * Pad w stylu kontrolera DJ: ciemna gumowa powierzchnia, dioda LED u góry,
 * po dotknięciu (jeśli [edgeGlow]) świecące krawędzie, dla aktywnej pętli stała poświata.
 *
 * Reakcja na pierwsze dotknięcie jest natychmiastowa. Jeśli drugie dotknięcie przyjdzie w ciągu
 * [DOUBLE_TAP_MS] i [doubleTapEnabled] jest włączone, zamiast [onPress] wywoływane jest [onDoubleTap].
 */
@Composable
fun PadTile(
    label: String,
    tag: String?,
    color: Color,
    active: Boolean,
    edgeGlow: Boolean,
    enabled: Boolean,
    doubleTapEnabled: Boolean,
    modifier: Modifier = Modifier,
    onPress: () -> Unit,
    onDoubleTap: () -> Unit,
) {
    var pressed by remember { mutableStateOf(false) }
    val currentOnPress by rememberUpdatedState(onPress)
    val currentOnDoubleTap by rememberUpdatedState(onDoubleTap)
    val currentDoubleEnabled by rememberUpdatedState(doubleTapEnabled)
    val lastDown = remember { LongArray(1) }

    val on = pressed || active
    val lit by animateFloatAsState(
        if (on) 1f else 0f, tween(if (on) 30 else 220), label = "lit"
    )
    val glow by animateFloatAsState(
        if (pressed && edgeGlow) 1f else 0f, tween(if (pressed) 30 else 320), label = "glow"
    )

    val shape = RoundedCornerShape(12.dp)

    Box(
        modifier = modifier
            .clip(shape)
            .background(Brush.verticalGradient(listOf(Color(0xFF2B2E36), Color(0xFF15171B))))
            .drawBehind {
                val r = 12.dp.toPx()

                if (lit > 0f) {
                    drawRoundRect(color = color.copy(alpha = 0.28f * lit), cornerRadius = CornerRadius(r))
                }

                // świecące krawędzie: dotyk (opcjonalnie) lub stała poświata aktywnej pętli
                val g = max(glow, if (active) 0.75f else 0f)
                if (g > 0f) {
                    fun edge(width: Float, alpha: Float) {
                        val inset = width / 2f
                        drawRoundRect(
                            color = color.copy(alpha = (alpha * g).coerceIn(0f, 1f)),
                            topLeft = Offset(inset, inset),
                            size = Size(size.width - width, size.height - width),
                            cornerRadius = CornerRadius(max(r - inset, 0f)),
                            style = Stroke(width),
                        )
                    }
                    edge(14.dp.toPx(), 0.10f)
                    edge(8.dp.toPx(), 0.22f)
                    edge(3.dp.toPx(), 0.95f)
                }

                // dioda LED
                val ledW = size.width * 0.34f
                val ledH = 3.dp.toPx()
                val ledTop = 6.dp.toPx()
                val ledLeft = (size.width - ledW) / 2f
                if (lit > 0f) {
                    val pad = 4.dp.toPx()
                    drawRoundRect(
                        color = color.copy(alpha = 0.25f * lit),
                        topLeft = Offset(ledLeft - pad, ledTop - pad),
                        size = Size(ledW + 2 * pad, ledH + 2 * pad),
                        cornerRadius = CornerRadius(6.dp.toPx()),
                    )
                }
                drawRoundRect(
                    color = color.copy(alpha = (0.22f + 0.78f * lit).coerceIn(0f, 1f)),
                    topLeft = Offset(ledLeft, ledTop),
                    size = Size(ledW, ledH),
                    cornerRadius = CornerRadius(ledH / 2f),
                )
            }
            .border(1.dp, ConsoleColors.Bezel, shape)
            .pointerInput(enabled) {
                if (enabled) {
                    // reakcja na samo dotknięcie (bez czekania na puszczenie) = niższe opóźnienie
                    detectTapGestures(onPress = {
                        val now = SystemClock.uptimeMillis()
                        val delta = now - lastDown[0]
                        val isDouble = currentDoubleEnabled && (delta in 1L..DOUBLE_TAP_MS)
                        lastDown[0] = if (isDouble) 0L else now
                        pressed = true
                        try {
                            if (isDouble) currentOnDoubleTap() else currentOnPress()
                            tryAwaitRelease()
                        } finally {
                            pressed = false
                        }
                    })
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                label,
                color = if (on) Color.White else Color(0xFFC5CBD6),
                fontFamily = ConsoleFont,
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp,
                letterSpacing = 1.sp,
                maxLines = 1,
            )
            if (tag != null) {
                Text(
                    tag,
                    color = if (on) color else ConsoleColors.Label,
                    fontFamily = ConsoleFont,
                    fontSize = 9.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
