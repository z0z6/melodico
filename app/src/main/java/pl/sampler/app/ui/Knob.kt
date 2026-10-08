package pl.sampler.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.round
import kotlin.math.sin

/**
 * Pokrętło: przeciągnięcie w górę lub w prawo zwiększa wartość, w dół lub w lewo zmniejsza.
 * Podwójne dotknięcie przywraca [defaultValue].
 */
@Composable
fun Knob(
    label: String,
    value: Float,
    minValue: Float,
    maxValue: Float,
    defaultValue: Float,
    step: Float,
    readout: String,
    color: Color,
    onChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    knobSize: Dp = 48.dp,
) {
    val currentValue by rememberUpdatedState(value)
    val currentOnChange by rememberUpdatedState(onChange)

    Column(
        modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            label,
            color = ConsoleColors.Label,
            fontFamily = ConsoleFont,
            fontWeight = FontWeight.Bold,
            fontSize = 9.sp,
            letterSpacing = 2.sp,
        )
        Canvas(
            Modifier
                .size(knobSize)
                .pointerInput(Unit) {
                    detectTapGestures(onDoubleTap = { currentOnChange(defaultValue) })
                }
                .pointerInput(Unit) {
                    var acc = 0f
                    detectDragGestures(
                        onDragStart = { acc = currentValue },
                        onDrag = { change, drag ->
                            change.consume()
                            val range = maxValue - minValue
                            val delta = (drag.x - drag.y) / 220.dp.toPx() * range
                            acc = (acc + delta).coerceIn(minValue, maxValue)
                            val stepped = (round(acc / step) * step).coerceIn(minValue, maxValue)
                            if (stepped != currentValue) currentOnChange(stepped)
                        },
                    )
                }
        ) {
            val frac = ((value - minValue) / (maxValue - minValue)).coerceIn(0f, 1f)
            val s = size.minDimension
            val ringW = s * 0.09f
            val arcTopLeft = Offset(ringW / 2, ringW / 2)
            val arcSize = Size(s - ringW, s - ringW)
            val c = Offset(size.width / 2, size.height / 2)

            drawCircle(Color(0xFF0B0C0F), radius = s / 2)
            drawArc(
                color = Color(0xFF2A2D34), startAngle = 135f, sweepAngle = 270f, useCenter = false,
                topLeft = arcTopLeft, size = arcSize, style = Stroke(ringW, cap = StrokeCap.Round),
            )
            if (frac > 0f) {
                drawArc(
                    color = color.copy(alpha = 0.25f), startAngle = 135f, sweepAngle = 270f * frac,
                    useCenter = false, topLeft = arcTopLeft, size = arcSize,
                    style = Stroke(ringW * 1.9f, cap = StrokeCap.Round),
                )
                drawArc(
                    color = color, startAngle = 135f, sweepAngle = 270f * frac, useCenter = false,
                    topLeft = arcTopLeft, size = arcSize, style = Stroke(ringW, cap = StrokeCap.Round),
                )
            }

            // trzon pokrętła
            drawCircle(
                brush = Brush.verticalGradient(listOf(Color(0xFF50555F), Color(0xFF22252B))),
                radius = s * 0.33f, center = c,
            )
            val ang = ((135f + 270f * frac) * PI / 180.0)
            val r1 = s * 0.12f
            val r2 = s * 0.30f
            drawLine(
                color = Color.White,
                start = Offset(c.x + r1 * cos(ang).toFloat(), c.y + r1 * sin(ang).toFloat()),
                end = Offset(c.x + r2 * cos(ang).toFloat(), c.y + r2 * sin(ang).toFloat()),
                strokeWidth = s * 0.06f, cap = StrokeCap.Round,
            )
        }
        Box(
            Modifier
                .background(Color(0xFF050607), RoundedCornerShape(4.dp))
                .border(1.dp, Color(0xFF2A2D34), RoundedCornerShape(4.dp))
                .padding(horizontal = 6.dp, vertical = 1.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                readout,
                color = color,
                fontFamily = ConsoleFont,
                fontWeight = FontWeight.Bold,
                fontSize = 11.sp,
                maxLines = 1,
            )
        }
    }
}
