import { Capacitor } from "@capacitor/core";

/** Native chrome once the first screen is drawn: light status bar text, then fade the splash. */
export async function boot(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    // Browser preview at phone size: simulate the notch so layout matches the device.
    if (new URLSearchParams(location.search).has("sim")) document.documentElement.classList.add("sim");
    return;
  }
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === "android") await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    /* status bar plugin missing: keep defaults */
  }
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch {
    /* no splash */
  }
}
