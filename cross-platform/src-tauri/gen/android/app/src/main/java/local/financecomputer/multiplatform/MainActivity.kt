package local.financecomputer.multiplatform

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val visibleArea = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(visibleArea.left, visibleArea.top, visibleArea.right, visibleArea.bottom)
      insets
    }
    ViewCompat.requestApplyInsets(content)
  }
}
