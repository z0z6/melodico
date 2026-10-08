package pl.sampler.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import pl.sampler.app.audio.AudioEngine
import pl.sampler.app.ui.SamplerScreen

class MainActivity : ComponentActivity() {

    private val engine = AudioEngine()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                SamplerScreen(engine)
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
