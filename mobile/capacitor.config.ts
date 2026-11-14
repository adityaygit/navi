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
      // "none" on iPhone: the web view keeps its size and the app animates
      // its own bottom edge with the keyboard (src/native/keyboard.ts), so
      // nothing jumps. A resizing web view snapped to the new size in one
      // frame and the chat redrew a beat later. Android ignores this and
      // keeps adjustResize (the OS animates it); resizeOnFullScreen stays off
      // because Capacitor 8's SystemBars already pads for the keyboard there.
      resize: KeyboardResize.None,
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
