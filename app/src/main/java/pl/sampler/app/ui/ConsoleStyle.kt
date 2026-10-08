package pl.sampler.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.sqrt
import pl.sampler.app.audio.AudioEngine

object ConsoleColors {
    val PanelTop = Color(0xFF23262D)
    val PanelBottom = Color(0xFF121418)
    val Bezel = Color(0xFF3A3F4A)
    val Label = Color(0xFF9AA3B2)
    val LedOff = Color(0xFF2A2D34)
    val Red = Color(0xFFFF1744)
    val Green = Color(0xFF00E676)
    val Amber = Color(0xFFFFC400)
    val Cyan = Color(0xFF00E5FF)
}

val ConsoleFont = FontFamily.Monospace

/** Metalowy panel z fazką. */
fun Modifier.consolePanel(radius: Dp = 12.dp): Modifier {
    val shape = RoundedCornerShape(radius)
    return this
        .clip(shape)
        .background(Brush.verticalGradient(listOf(ConsoleColors.PanelTop, ConsoleColors.PanelBottom)))
        .border(1.dp, ConsoleColors.Bezel, shape)
}

/** Mały przycisk konsoli z diodą LED u góry. */
@Composable
fun ConsoleButton(
    text: String,
    ledColor: Color,
    lit: Boolean,
    modifier: Modifier = Modifier,
    fontSize: TextUnit = 9.sp,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(6.dp)
    Box(
        modifier = modifier
            .clip(shape)
            .background(Brush.verticalGradient(listOf(Color(0xFF30343D), Color(0xFF1A1C21))))
            .border(1.dp, if (lit) ledColor.copy(alpha = 0.8f) else ConsoleColors.Bezel, shape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .align(Alignment.TopCenter)
                .padding(top = 2.dp)
                .width(14.dp)
                .height(2.dp)
                .clip(RoundedCornerShape(1.dp))
                .background(if (lit) ledColor else ConsoleColors.LedOff)
        )
        Text(
            text,
            color = if (lit) ledColor else ConsoleColors.Label,
            fontFamily = ConsoleFont,
            fontWeight = FontWeight.Bold,
            fontSize = fontSize,
            letterSpacing = 1.sp,
            maxLines = 1,
        )
    }
}

/** Segmentowy wskaźnik wysterowania (zielony / żółty / czerwony). */
@Composable
fun LevelMeter(engine: AudioEngine, modifier: Modifier = Modifier) {
    var level by remember { mutableStateOf(0f) }
    LaunchedEffect(Unit) {
        while (true) {
            withFrameNanos {
                val p = engine.levelPeak
                level = if (p > level) p else level * 0.88f
            }
        }
    }
    Canvas(modifier) {
        val n = 18
        val gap = 2.dp.toPx()
        val segW = (size.width - gap * (n - 1)) / n
        val lit = (sqrt(level.coerceIn(0f, 1f)) * n).toInt()
        for (i in 0 until n) {
            val c = when {
                i >= 15 -> ConsoleColors.Red
                i >= 11 -> ConsoleColors.Amber
                else -> ConsoleColors.Green
            }
            drawRoundRect(
                color = if (i < lit) c else c.copy(alpha = 0.14f),
                topLeft = Offset(i * (segW + gap), 0f),
                size = Size(segW, size.height),
                cornerRadius = CornerRadius(1.5.dp.toPx()),
            )
        }
    }
}
