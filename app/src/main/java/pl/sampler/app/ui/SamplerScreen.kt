package pl.sampler.app.ui

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import java.util.Locale
import kotlin.math.pow
import pl.sampler.app.audio.AudioEngine
import pl.sampler.app.audio.SampleSlot
import pl.sampler.app.audio.SlotStatus
import pl.sampler.app.audio.SynthPresets

private val SlotColors = listOf(
    Color(0xFF00E5FF),
    Color(0xFF76FF03),
    Color(0xFFFF4081),
    Color(0xFFFFD740),
)

@Composable
fun SamplerScreen(engine: AudioEngine) {
    val context = LocalContext.current
    val activeLoops = engine.activeLoops

    var edgeGlow by remember { mutableStateOf(true) }
    var bpm by remember { mutableStateOf(SynthPresets.BASE_BPM.toFloat()) }
    var semis by remember { mutableStateOf(0f) }

    // --- zgoda na mikrofon ---
    var pendingMicSlot by remember { mutableStateOf(-1) }
    val micPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val i = pendingMicSlot
        pendingMicSlot = -1
        if (granted && i >= 0) {
            engine.startRecording(context, engine.slots[i])
        } else if (!granted) {
            Toast.makeText(context, "Brak zgody na użycie mikrofonu", Toast.LENGTH_SHORT).show()
        }
    }

    // --- wybór pliku ---
    var pendingFileSlot by remember { mutableStateOf(-1) }
    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        val i = pendingFileSlot
        pendingFileSlot = -1
        if (uri != null && i >= 0) engine.loadFile(context, engine.slots[i], uri)
    }

    fun onMic(slot: SampleSlot) {
        when {
            slot.status == SlotStatus.RECORDING -> engine.stopRecording()
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED -> engine.startRecording(context, slot)
            else -> {
                pendingMicSlot = slot.index
                micPermission.launch(Manifest.permission.RECORD_AUDIO)
            }
        }
    }

    fun onFile(slot: SampleSlot) {
        if (slot.status == SlotStatus.RECORDING || slot.status == SlotStatus.LOADING) return
        pendingFileSlot = slot.index
        filePicker.launch(arrayOf("audio/*"))
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF0D0E12), Color(0xFF040506))))
            .safeDrawingPadding()
            .padding(8.dp)
    ) {
        // ---------- górny pasek ----------
        Row(
            Modifier
                .fillMaxWidth()
                .height(38.dp)
                .consolePanel(8.dp)
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "SAMPLER",
                color = Color.White,
                fontFamily = ConsoleFont,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                letterSpacing = 4.sp,
            )
            Text(
                "MK1",
                color = ConsoleColors.Amber,
                fontFamily = ConsoleFont,
                fontWeight = FontWeight.Bold,
                fontSize = 10.sp,
            )
            LevelMeter(engine, Modifier.weight(1f).height(14.dp))
            ConsoleButton("EDGE GLOW", ConsoleColors.Green, edgeGlow, Modifier.width(88.dp).height(24.dp)) {
                edgeGlow = !edgeGlow
            }
            ConsoleButton("STOP ALL", ConsoleColors.Red, false, Modifier.width(78.dp).height(24.dp)) {
                engine.stopAll()
            }
        }

        Spacer(Modifier.height(8.dp))

        Row(
            Modifier.weight(1f).fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // ---------- lewa strona: presety 4x3 ----------
            Column(
                Modifier
                    .weight(3f)
                    .fillMaxHeight()
                    .consolePanel()
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                engine.pads.chunked(4).forEach { rowPads ->
                    Row(
                        Modifier.weight(1f).fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        rowPads.forEach { pad ->
                            PadTile(
                                label = pad.label,
                                tag = if (pad.loop) "LOOP" else null,
                                color = Color(pad.colorArgb),
                                active = pad.id in activeLoops,
                                edgeGlow = edgeGlow,
                                enabled = true,
                                modifier = Modifier.weight(1f).fillMaxHeight(),
                                onPress = { engine.press(pad) },
                            )
                        }
                    }
                }
            }

            // ---------- prawa strona: pokrętła + sloty REC ----------
            Column(
                Modifier.weight(2.1f).fillMaxHeight(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(100.dp)
                        .consolePanel()
                        .padding(6.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Knob(
                        label = "TEMPO",
                        value = bpm,
                        minValue = 60f,
                        maxValue = 180f,
                        defaultValue = SynthPresets.BASE_BPM.toFloat(),
                        step = 1f,
                        readout = "${bpm.toInt()} BPM",
                        color = ConsoleColors.Cyan,
                        onChange = {
                            bpm = it
                            engine.setTempo(it / SynthPresets.BASE_BPM)
                        },
                    )
                    Knob(
                        label = "KEY",
                        value = semis,
                        minValue = -12f,
                        maxValue = 12f,
                        defaultValue = 0f,
                        step = 1f,
                        readout = (if (semis > 0f) "+" else "") + "${semis.toInt()} ST",
                        color = Color(0xFFFF9100),
                        onChange = {
                            semis = it
                            engine.setPitch(2.0.pow(it / 12.0))
                        },
                    )
                }

                engine.slots.chunked(2).forEach { rowSlots ->
                    Row(
                        Modifier.weight(1f).fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        rowSlots.forEach { slot ->
                            SlotTile(
                                engine = engine,
                                slot = slot,
                                color = SlotColors[slot.index],
                                active = slot.padId in activeLoops,
                                edgeGlow = edgeGlow,
                                modifier = Modifier.weight(1f).fillMaxHeight(),
                                onMic = { onMic(slot) },
                                onFile = { onFile(slot) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SlotTile(
    engine: AudioEngine,
    slot: SampleSlot,
    color: Color,
    active: Boolean,
    edgeGlow: Boolean,
    modifier: Modifier,
    onMic: () -> Unit,
    onFile: () -> Unit,
) {
    val status = slot.status
    val recording = status == SlotStatus.RECORDING

    val tag = when (status) {
        SlotStatus.EMPTY -> "EMPTY"
        SlotStatus.RECORDING ->
            String.format(Locale.US, "REC %.1f/%d s", slot.seconds, AudioEngine.MAX_SECONDS)
        SlotStatus.LOADING -> "LOADING..."
        SlotStatus.READY -> slot.name.take(16) + if (slot.loop) " LOOP" else ""
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        PadTile(
            label = "REC ${slot.index + 1}",
            tag = tag,
            color = if (recording) ConsoleColors.Red else color,
            active = active || recording,
            edgeGlow = edgeGlow,
            enabled = status == SlotStatus.READY,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            onPress = { engine.pressSlot(slot) },
        )
        Row(
            Modifier.fillMaxWidth().height(26.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            ConsoleButton("MIC", ConsoleColors.Red, recording, Modifier.weight(1f).fillMaxHeight()) {
                onMic()
            }
            ConsoleButton(
                "FILE", ConsoleColors.Amber, status == SlotStatus.LOADING,
                Modifier.weight(1f).fillMaxHeight(),
            ) { onFile() }
            ConsoleButton("LOOP", ConsoleColors.Green, slot.loop, Modifier.weight(1f).fillMaxHeight()) {
                engine.setSlotLoop(slot, !slot.loop)
            }
            ConsoleButton("CLR", ConsoleColors.Label, false, Modifier.weight(1f).fillMaxHeight()) {
                engine.clearSlot(slot)
            }
        }
    }
}
