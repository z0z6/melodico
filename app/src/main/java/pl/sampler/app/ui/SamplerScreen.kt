package pl.sampler.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pl.sampler.app.audio.AudioEngine

@Composable
fun SamplerScreen(engine: AudioEngine) {
    val activeLoops = engine.activeLoops

    Column(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF101114))
            .safeDrawingPadding()
            .padding(10.dp)
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("SAMPLER", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Spacer(Modifier.weight(1f))
            Button(onClick = { engine.stopAll() }) { Text("STOP") }
        }
        Spacer(Modifier.height(8.dp))

        Row(
            Modifier.fillMaxSize(),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // Lewa strona: presety
            Column(
                Modifier.weight(3f).fillMaxHeight(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                engine.pads.chunked(4).forEach { rowPads ->
                    Row(
                        Modifier.weight(1f).fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        rowPads.forEach { pad ->
                            PadTile(
                                label = pad.label,
                                tag = if (pad.loop) "LOOP" else null,
                                color = Color(pad.colorArgb),
                                active = pad.id in activeLoops,
                                modifier = Modifier.weight(1f).fillMaxHeight(),
                                onPress = { engine.press(pad) },
                            )
                        }
                    }
                }
            }

            // Prawa strona: sloty na własne nagrania (w następnym kroku)
            Column(
                Modifier.weight(1.5f).fillMaxHeight(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                (1..4).chunked(2).forEach { slots ->
                    Row(
                        Modifier.weight(1f).fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        slots.forEach { n ->
                            PadTile(
                                label = "REC $n",
                                tag = "wkrótce",
                                color = Color(0xFF616161),
                                active = false,
                                modifier = Modifier.weight(1f).fillMaxHeight(),
                                onPress = {},
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun PadTile(
    label: String,
    tag: String?,
    color: Color,
    active: Boolean,
    modifier: Modifier = Modifier,
    onPress: () -> Unit,
) {
    var pressed by remember { mutableStateOf(false) }
    val currentOnPress by rememberUpdatedState(onPress)
    val lit = pressed || active
    val shape = RoundedCornerShape(14.dp)

    Box(
        modifier = modifier
            .clip(shape)
            .background(if (lit) color else color.copy(alpha = 0.45f))
            .border(2.dp, if (active) Color.White else Color.Transparent, shape)
            .pointerInput(Unit) {
                // reakcja na samo dotknięcie (bez czekania na puszczenie) = niższe opóźnienie
                detectTapGestures(onPress = {
                    pressed = true
                    currentOnPress()
                    tryAwaitRelease()
                    pressed = false
                })
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(label, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            if (tag != null) {
                Text(tag, color = Color.White.copy(alpha = 0.7f), fontSize = 11.sp)
            }
        }
    }
}
