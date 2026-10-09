package pl.sampler.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs

/** Poziomy suwak w stylu konsolety. [value] w zakresie 0..1; [centerDetent] łapie środek (np. pitch). */
@Composable
fun HFader(
    label: String,
    readout: String,
    value: Float,
    color: Color,
    onChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    centerDetent: Boolean = false,
) {
    val currentOnChange by rememberUpdatedState(onChange)

    Row(
        modifier.height(22.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            label,
            modifier = Modifier.width(34.dp),
            color = ConsoleColors.Label,
            fontFamily = ConsoleFont,
            fontWeight = FontWeight.Bold,
            fontSize = 8.sp,
            letterSpacing = 1.sp,
            maxLines = 1,
        )
        Canvas(
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .pointerInput(Unit) {
                    awaitEachGesture {
                        val half = 5.dp.toPx()
                        fun update(x: Float) {
                            val span = size.width - 2 * half
                            var v = ((x - half) / span).coerceIn(0f, 1f)
                            if (centerDetent && abs(v - 0.5f) < 0.03f) v = 0.5f
                            currentOnChange(v)
                        }
                        val down = awaitFirstDown(requireUnconsumed = false)
                        update(down.position.x)
                        down.consume()
                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            if (!change.pressed) break
                            update(change.position.x)
                            change.consume()
                        }
                    }
                }
        ) {
            val h = size.height
            val w = size.width
            val half = 5.dp.toPx()
            val trackH = 5.dp.toPx()
            val trackTop = (h - trackH) / 2f
            val x = half + (w - 2 * half) * value.coerceIn(0f, 1f)

            drawRoundRect(
                Color(0xFF050607), Offset(0f, trackTop), Size(w, trackH), CornerRadius(trackH / 2),
            )
            // wypełnienie: od lewej (lub od środka dla detentu)
            val from = if (centerDetent) w / 2f else 0f
            val left = minOf(from, x)
            val right = maxOf(from, x)
            drawRoundRect(
                color.copy(alpha = 0.85f), Offset(left, trackTop), Size(right - left, trackH),
                CornerRadius(trackH / 2),
            )
            if (centerDetent) {
                drawLine(
                    Color.White.copy(alpha = 0.5f), Offset(w / 2f, trackTop - 3.dp.toPx()),
                    Offset(w / 2f, trackTop + trackH + 3.dp.toPx()), strokeWidth = 1.dp.toPx(),
                )
            }
            // uchwyt
            val hw = 10.dp.toPx()
            drawRoundRect(
                brush = Brush.verticalGradient(listOf(Color(0xFF5A606C), Color(0xFF2A2D34))),
                topLeft = Offset(x - hw / 2f, 2.dp.toPx()),
                size = Size(hw, h - 4.dp.toPx()),
                cornerRadius = CornerRadius(3.dp.toPx()),
            )
            drawLine(
                Color.White, Offset(x, 4.dp.toPx()), Offset(x, h - 4.dp.toPx()), strokeWidth = 1.5.dp.toPx(),
            )
        }
        Text(
            readout,
            modifier = Modifier.width(38.dp),
            color = color,
            fontFamily = ConsoleFont,
            fontWeight = FontWeight.Bold,
            fontSize = 9.sp,
            maxLines = 1,
        )
    }
}
