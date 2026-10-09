package pl.sampler.app.ui

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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

// Układ: siatka kafelków (PAD_COLUMNS kolumn) + deck. Zmiana wag zmienia proporcje i rozmiar kafelków.
private const val PAD_COLUMNS = 6
private const val PADS_WEIGHT = 3.2f
private const val DECK_WEIGHT = 1f

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
    var doubleTapLoop by remember { mutableStateOf(true) }
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

    // --- wybór pliku do slotu REC ---
    var pendingFileSlot by remember { mutableStateOf(-1) }
    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        val i = pendingFileSlot
        pendingFileSlot = -1
        if (uri != null && i >= 0) engine.loadFile(context, engine.slots[i], uri)
    }

    // --- wybór tracka na deck ---
    val deckPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri != null) engine.loadDeck(context, uri)
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
            .padding(6.dp)
    ) {
        // ---------- górny pasek: tytuł, miernik, pokrętła, przełączniki ----------
        Row(
            Modifier
                .fillMaxWidth()
                .height(48.dp)
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
            LevelMeter(engine, Modifier.weight(1f).height(14.dp))
            CompactKnob(
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
            CompactKnob(
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
            ConsoleButton("GLOW", ConsoleColors.Green, edgeGlow, Modifier.width(54.dp).height(24.dp)) {
                edgeGlow = !edgeGlow
            }
            ConsoleButton("2xTAP", ConsoleColors.Amber, doubleTapLoop, Modifier.width(58.dp).height(24.dp)) {
                doubleTapLoop = !doubleTapLoop
            }
            ConsoleButton("STOP", ConsoleColors.Red, false, Modifier.width(54.dp).height(24.dp)) {
                engine.stopAll()
            }
        }

        Spacer(Modifier.height(6.dp))

        Row(
            Modifier.weight(1f).fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // ---------- siatka: presety + sloty REC w ostatnim rzędzie ----------
            Column(
                Modifier
                    .weight(PADS_WEIGHT)
                    .fillMaxHeight()
                    .consolePanel()
                    .padding(6.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                val padRows = engine.pads.chunked(PAD_COLUMNS)
                padRows.forEachIndexed { idx, rowPads ->
                    Row(
                        Modifier.weight(1f).fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        rowPads.forEach { pad ->
                            PadTile(
                                label = pad.label,
                                tag = if (pad.id in engine.loopModes) "LOOP" else null,
                                color = Color(pad.colorArgb),
                                active = pad.id in activeLoops,
                                edgeGlow = edgeGlow,
                                enabled = true,
                                doubleTapEnabled = doubleTapLoop,
                                modifier = Modifier.weight(1f).fillMaxHeight(),
                                onPress = { engine.press(pad) },
                                onDoubleTap = { engine.toggleLoopMode(pad) },
                            )
                        }
                        if (idx == padRows.lastIndex) {
                            engine.slots.forEach { slot ->
                                SlotTile(
                                    engine = engine,
                                    slot = slot,
                                    color = SlotColors[slot.index],
                                    active = slot.padId in activeLoops,
                                    edgeGlow = edgeGlow,
                                    doubleTapLoop = doubleTapLoop,
                                    modifier = Modifier.weight(1f).fillMaxHeight(),
                                    onMic = { onMic(slot) },
                                    onFile = { onFile(slot) },
                                )
                            }
                        }
                    }
                }
            }

            // ---------- deck winylowy ----------
            DeckPanel(
                engine = engine,
                onLoad = { deckPicker.launch(arrayOf("audio/*")) },
                modifier = Modifier.weight(DECK_WEIGHT).fillMaxHeight(),
            )
        }
    }
}

/** Kafelek REC: pad + małe przyciski MIC / FILE / CLR nałożone na dole. */
@Composable
private fun SlotTile(
    engine: AudioEngine,
    slot: SampleSlot,
    color: Color,
    active: Boolean,
    edgeGlow: Boolean,
    doubleTapLoop: Boolean,
    modifier: Modifier,
    onMic: () -> Unit,
    onFile: () -> Unit,
) {
    val status = slot.status
    val recording = status == SlotStatus.RECORDING

    val tag = when (status) {
        SlotStatus.EMPTY -> "EMPTY"
        SlotStatus.RECORDING ->
            String.format(Locale.US, "%.1f/%d s", slot.seconds, AudioEngine.MAX_SECONDS)
        SlotStatus.LOADING -> "LOADING..."
        SlotStatus.READY -> slot.name.take(12) + if (slot.loop) " LOOP" else ""
    }

    Box(modifier) {
        PadTile(
            label = "REC ${slot.index + 1}",
            tag = tag,
            color = if (recording) ConsoleColors.Red else color,
            active = active || recording,
            edgeGlow = edgeGlow,
            enabled = status == SlotStatus.READY,
            doubleTapEnabled = doubleTapLoop,
            modifier = Modifier.fillMaxSize(),
            onPress = { engine.pressSlot(slot) },
            onDoubleTap = { engine.toggleSlotLoopMode(slot) },
        )
        Row(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 4.dp)
                .height(20.dp),
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            ConsoleButton(
                "MIC", ConsoleColors.Red, recording,
                Modifier.weight(1f).fillMaxHeight(), fontSize = 8.sp,
            ) { onMic() }
            ConsoleButton(
                "FILE", ConsoleColors.Amber, status == SlotStatus.LOADING,
                Modifier.weight(1f).fillMaxHeight(), fontSize = 8.sp,
            ) { onFile() }
            ConsoleButton(
                "CLR", ConsoleColors.Label, false,
                Modifier.weight(1f).fillMaxHeight(), fontSize = 8.sp,
            ) { engine.clearSlot(slot) }
        }
    }
}
