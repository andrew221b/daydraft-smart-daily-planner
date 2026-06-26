package dev.daydraft.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // MUST run super.onCreate() FIRST so AppCompat fully applies the
        // NoActionBar theme and installs the window decor itself. Touching the
        // window (via EdgeToEdge) before this pre-creates the decor and the
        // default action bar comes back — that was the dark "DayDraft + icon"
        // strip at the top.
        super.onCreate(savedInstanceState);

        if (getSupportActionBar() != null) {
            getSupportActionBar().hide();
        }

        // Explicitly set Edge-to-Edge without relying on the androidx EdgeToEdge helper,
        // which can sometimes conflict with Capacitor's inset handling or be overridden.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }

        View decorView = getWindow().getDecorView();
        decorView.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decorView);
            if (insets != null) {
                int bottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
                float density = getResources().getDisplayMetrics().density;
                float bottomDp = bottom / density;
                
                if (getBridge() != null && getBridge().getWebView() != null) {
                    WebView webView = getBridge().getWebView();
                    webView.post(() -> {
                        String js = "document.documentElement.style.setProperty('--safe-area-inset-bottom', '" + bottomDp + "px');";
                        webView.evaluateJavascript(js, null);
                    });
                }
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        // Capacitor plugins (like StatusBar or Keyboard) often asynchronously reset 
        // the system UI flags or insets when the app boots or resumes. 
        // Enforcing edge-to-edge here guarantees the WebView always draws behind 
        // the transparent navigation bar.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
    }
}
