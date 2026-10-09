package pl.sampler.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import pl.sampler.app.audio.AudioEngine
import pl.sampler.app.ui.IntroScreen
import pl.sampler.app.ui.SamplerScreen

class MainActivity : ComponentActivity() {

    private val engine = AudioEngine()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                var showIntro by remember { mutableStateOf(true) }
                Crossfade(
                    targetState = showIntro,
                    animationSpec = tween(500),
                    label = "intro",
                ) { intro ->
                    if (intro) IntroScreen(onFinished = { showIntro = false })
                    else SamplerScreen(engine)
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        engine.start()
    }

    override fun onStop() {
        super.onStop()
        engine.stop()
    }
}
