import { Capacitor } from "@capacitor/core";

// The keyboard (M6): on iPhone the app is not resized by the system (Keyboard
// resize "none"); instead --kb is set the moment the keyboard starts to rise
// (keyboardWillShow), and global.css eases it over the same 250 ms curve, so
// the message bar and sheets travel up WITH the keyboard instead of waiting
// for it and jumping. Android already resizes the window itself (adjustResize
// + SystemBars), so nothing is set there. In a browser the visual viewport
// stands in for it.

const root = () => document.documentElement;

/** Tell the page how tall the keyboard is (0 = hidden). */
export function setKeyboard(height: number) {
  const h = Math.max(0, Math.round(height));
  root().style.setProperty("--kb", `${h}px`);
  root().style.setProperty("--kbo", h > 0 ? "0" : "1");
  root().classList.toggle("kb", h > 0);
}

export function startKeyboard(): () => void {
  if (import.meta.env.DEV) (window as unknown as { __naviKeyboard?: typeof setKeyboard }).__naviKeyboard = setKeyboard;
  const off: (() => void)[] = [];
  if (Capacitor.isNativePlatform()) {
    if (Capacitor.getPlatform() === "ios") {
      void import("@capacitor/keyboard").then(async ({ Keyboard }) => {
        // The web view must never scroll itself to "reveal" the field: the page already moves.
        await Keyboard.setScroll({ isDisabled: true }).catch(() => {});
        const a = await Keyboard.addListener("keyboardWillShow", (i) => setKeyboard(i.keyboardHeight));
        const b = await Keyboard.addListener("keyboardWillHide", () => setKeyboard(0));
        off.push(() => void a.remove(), () => void b.remove());
      });
      const reset = () => {
        if (root().classList.contains("kb") && (window.scrollY || window.scrollX)) window.scrollTo(0, 0);
      };
      window.addEventListener("scroll", reset, { passive: true });
      off.push(() => window.removeEventListener("scroll", reset));
    }
  } else if (window.visualViewport) {
    const vv = window.visualViewport;
    const fit = () => setKeyboard(window.innerHeight - vv.height - vv.offsetTop > 80 ? window.innerHeight - vv.height - vv.offsetTop : 0);
    vv.addEventListener("resize", fit);
    off.push(() => vv.removeEventListener("resize", fit));
  }
  return () => off.forEach((f) => f());
}
