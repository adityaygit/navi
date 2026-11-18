package app.meetnavi.navi;

import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;
import android.view.View;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // No overscroll stretch/glow on the root web view (the Android
        // equivalent of iOS bounce). Scrollable areas inside the page still
        // scroll normally.
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        }
        runAtScreenRefreshRate();
    }

    /**
     * Many Android phones with a 90/120 Hz screen keep an app at 60 Hz unless it
     * asks. Ask for the fastest mode the screen has at its current size, so the
     * app is limited by the phone and not by us.
     */
    private void runAtScreenRefreshRate() {
        try {
            Display display = getWindowManager().getDefaultDisplay();
            Display.Mode current = display.getMode();
            Display.Mode best = current;
            for (Display.Mode m : display.getSupportedModes()) {
                if (m.getPhysicalWidth() == current.getPhysicalWidth() && m.getPhysicalHeight() == current.getPhysicalHeight() && m.getRefreshRate() > best.getRefreshRate()) {
                    best = m;
                }
            }
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.preferredDisplayModeId = best.getModeId();
            getWindow().setAttributes(lp);
        } catch (Exception ignored) {
            // Keep the system's choice.
        }
    }
}
