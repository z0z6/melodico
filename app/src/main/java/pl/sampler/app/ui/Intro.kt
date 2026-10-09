package pl.sampler.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

private val NeonCyan = Color(0xFF00E5FF)
private val NeonMagenta = Color(0xFFFF2D95)
private val NeonViolet = Color(0xFF7C4DFF)

/**
 * Intro: wirująca neonowa płyta, pulsujące pierścienie, equalizer i tytuł wjeżdżający z poświatą.
 * Trwa ok. 3,2 s; dotknięcie ekranu pomija intro.
 */
@Composable
fun IntroScreen(onFinished: () -> Unit) {
    val progress = remember { Animatable(0f) }
    var done by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        progress.animateTo(1f, tween(durationMillis = 3200, easing = LinearEasing))
        if (!done) {
            done = true
            onFinished()
        }
    }

    val p = progress.value
    fun phase(from: Float, to: Float) = ((p - from) / (to - from)).coerceIn(0f, 1f)
    fun ease(x: Float) = 1f - (1f - x) * (1f - x) * (1f - x)

    val appear = ease(phase(0f, 0.22f))
    val title = ease(phase(0.20f, 0.52f))
    val tagline = ease(phase(0.48f, 0.70f))
    val hint = phase(0.30f, 0.45f)

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF05060A))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) {
                if (!done) {
                    done = true
                    onFinished()
                }
            }
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height

            // tło i neonowe poświaty
            drawRect(Brush.verticalGradient(listOf(Color(0xFF0B0D17), Color(0xFF040508))))
            val gA = 0.30f * appear
            val g1 = Offset(w * 0.22f, h * 0.30f)
            val g2 = Offset(w * 0.85f, h * 0.80f)
            drawCircle(
                Brush.radialGradient(listOf(NeonCyan.copy(alpha = gA), Color.Transparent), center = g1, radius = w * 0.40f),
                radius = w * 0.40f, center = g1,
            )
            drawCircle(
                Brush.radialGradient(listOf(NeonMagenta.copy(alpha = gA), Color.Transparent), center = g2, radius = w * 0.40f),
                radius = w * 0.40f, center = g2,
            )

            // płyta po lewej stronie
            val c = Offset(w * 0.27f, h * 0.45f)
            val r = min(w * 0.19f, h * 0.33f) * (0.7f + 0.3f * appear)
            val spin = p * 900f

            for (k in 0..2) {
                val t = (p * 3.2f + k / 3f) % 1f
                drawCircle(
                    NeonCyan.copy(alpha = (1f - t) * 0.30f * appear),
                    radius = r * (1f + 0.9f * t), center = c, style = Stroke(2.dp.toPx()),
                )
            }

            drawCircle(Color(0xFF0A0B10), r, c, alpha = appear)
            for (i in 1..6) {
                drawCircle(
                    Color.White.copy(alpha = 0.05f * appear), r * (0.38f + 0.09f * i), c, style = Stroke(1f),
                )
            }
            rotate(spin, c) {
                drawCircle(
                    Brush.sweepGradient(listOf(NeonCyan, NeonMagenta, NeonCyan), center = c),
                    radius = r, center = c, alpha = appear, style = Stroke(r * 0.045f),
                )
                drawCircle(
                    Brush.linearGradient(
                        listOf(NeonMagenta, NeonViolet),
                        start = Offset(c.x - r * 0.3f, c.y - r * 0.3f),
                        end = Offset(c.x + r * 0.3f, c.y + r * 0.3f),
                    ),
                    radius = r * 0.30f, center = c, alpha = appear,
                )
                drawLine(
                    Color.White.copy(alpha = 0.9f * appear),
                    Offset(c.x, c.y - r * 0.10f), Offset(c.x, c.y - r * 0.26f),
                    strokeWidth = r * 0.035f, cap = StrokeCap.Round,
                )
            }
            drawCircle(Color(0xFF0A0B10), r * 0.035f, c)
            drawCircle(
                Brush.sweepGradient(
                    0f to Color.Transparent,
                    0.07f to Color.White.copy(alpha = 0.12f * appear),
                    0.14f to Color.Transparent,
                    0.5f to Color.Transparent,
                    0.57f to Color.White.copy(alpha = 0.12f * appear),
                    0.64f to Color.Transparent,
                    1f to Color.Transparent,
                    center = c,
                ),
                r * 0.97f, c,
            )

            // equalizer na dole
            val n = 32
            val bw = w * 0.9f / n
            val gap = bw * 0.35f
            val baseY = h * 0.97f
            val maxH = h * 0.20f
            for (i in 0 until n) {
                val m = abs(sin(p * 14f + i * 0.6f)) * (0.5f + 0.5f * abs(cos(p * 9f + i * 0.31f)))
                val bh = maxH * (0.08f + 0.92f * m) * appear
                drawRoundRect(
                    color = lerp(NeonCyan, NeonMagenta, i / (n - 1f)).copy(alpha = 0.85f),
                    topLeft = Offset(w * 0.05f + i * bw, baseY - bh),
                    size = Size(bw - gap, bh),
                    cornerRadius = CornerRadius(bw * 0.3f),
                )
            }
        }

        // tytuł po prawej
        Row(Modifier.fillMaxSize()) {
            Spacer(Modifier.weight(0.5f))
            Column(
                Modifier.weight(0.5f).fillMaxHeight().padding(bottom = 40.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    "SAMPLER",
                    style = TextStyle(
                        color = Color.White.copy(alpha = title),
                        fontFamily = ConsoleFont,
                        fontWeight = FontWeight.Bold,
                        fontSize = 46.sp,
                        letterSpacing = (26f - 20f * title).sp,
                        shadow = Shadow(
                            color = NeonCyan.copy(alpha = 0.85f * title),
                            offset = Offset.Zero,
                            blurRadius = 28f,
                        ),
                    ),
                    maxLines = 1,
                )
                Spacer(Modifier.height(8.dp))
                Box(
                    Modifier
                        .fillMaxWidth(0.85f * title)
                        .height(2.dp)
                        .background(Brush.horizontalGradient(listOf(NeonCyan, NeonMagenta)))
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "TAP  ·  LOOP  ·  SCRATCH",
                    color = NeonCyan.copy(alpha = tagline),
                    fontFamily = ConsoleFont,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    letterSpacing = 4.sp,
                    maxLines = 1,
                )
            }
        }

        Text(
            "TAP TO SKIP",
            modifier = Modifier.align(Alignment.TopEnd).padding(12.dp),
            color = Color.White.copy(alpha = 0.35f * hint),
            fontFamily = ConsoleFont,
            fontSize = 9.sp,
            letterSpacing = 2.sp,
        )
    }
}
