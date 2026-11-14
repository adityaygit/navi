import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";

// Native shell for the Navi mobile app (iPhone + Android).
// The web bundle in dist/ is packed into the app; it talks to the
// backend at VITE_API_BASE over HTTPS. Nothing is loaded from a dev server
// unless CAP_SERVER_URL is set while syncing (local testing only).
const devServer = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "app.meetnavi.navi",
  appName: "Navi",
  webDir: "dist",
  // Pure black behind the web view on both platforms: no white flash on
  // launch, rotation or keyboard animation.
  backgroundColor: "#000000",
  ...(devServer ? { server: { url: devServer, cleartext: devServer.startsWith("http://") } } : {}),
  ios: {
    backgroundColor: "#000000",
    // The web app pads itself with env(safe-area-inset-*), so the web view
    // must run edge to edge with no automatic content insets.
    contentInset: "never",
    // No rubber-band bounce on the root web view; inner lists scroll normally.
    scrollEnabled: false,
    preferredContentMode: "mobile",
  },
  android: {
    backgroundColor: "#000000",
    // Release builds never accept http:// content.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      // The app calls SplashScreen.hide({ fadeOutDuration }) once its first
      // screen has rendered, so the stone is never replaced by a blank page.
      launchAutoHide: false,
      launchFadeOutDuration: 200,
      backgroundColor: "#000000",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: false,
      splashImmersive: false,
    },
    SystemBars: {
      // Built into Capacitor 8 (Android). Edge-to-edge web view: with
      // viewport-fit=cover in index.html the env(safe-area-inset-*) values
      // are correct, and --safe-area-inset-* CSS variables are injected as a
      // fallback for older Android WebViews. Light icons on black.
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
      style: "DARK",
    },
    StatusBar: {
      // Light text and icons on the black app background, drawn over the
      // web view (the web app leaves room with env(safe-area-inset-top)).
      style: "DARK",
      backgroundColor: "#00000000",
      overlaysWebView: true,
    },
    Keyboard: {
      // "native": the web view itself shrinks to the space above the
      // keyboard, so a composer pinned with position: fixed; bottom: 0
      // rides the keyboard without any JavaScript measuring. The app can
      // still listen to keyboardWillShow/Hide for haptics or animation.
      // On Android, Capacitor 8's SystemBars already pads the web view by
      // the keyboard height (the activity uses adjustResize), so the old
      // resizeOnFullScreen workaround stays off to avoid a double resize.
      resize: KeyboardResize.Native,
      style: KeyboardStyle.Dark,
      resizeOnFullScreen: false,
      // Black behind the keyboard while it animates in (iOS).
      autoBackdropColor: "auto",
    },
    LocalNotifications: {
      // Android status-bar icon (white stone silhouette, see scripts/make-icons.py).
      smallIcon: "ic_stat_navi",
      iconColor: "#B9B2FF",
    },
  },
};

export default config;
