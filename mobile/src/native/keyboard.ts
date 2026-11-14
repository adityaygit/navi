import { Capacitor } from "@capacitor/core";

// The keyboard and the app move together.
//
// iPhone: the web view no longer jumps to a new size when the keyboard opens
// (capacitor.config.ts: Keyboard.resize "none"). Instead, as soon as iOS says
// the keyboard is about to show, the app's bottom edge glides up by the
// keyboard's height on the same curve and timing as the keyboard itself, so
// the composer rides on top of it and the chat (laid out bottom-up) keeps its
// newest message in view. The home-indicator gap below the composer folds
// away in the same motion.
//
// Android keeps the system's resize (adjustResize), which the OS animates.
//
// Browser preview: `?sim&kb` draws a stand-in keyboard so the motion can be
// checked and screenshotted without a phone.

/** iOS keyboard animation: ~0.25 s on a fast-out, soft-landing curve. */
const DURATION = 280;
const CURVE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SIM_HEIGHT = 336;

const root = document.documentElement;

function safeBottomPx(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--sab)";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

let sab = 0;
/** Moves the app's bottom edge to sit `height` px up (0 = keyboard closed). */
function lift(height: number) {
  if (!sab) sab = safeBottomPx();
  // Over the keyboard the composer needs only a small gap, not the home-indicator space.
  const offset = height > 0 ? Math.max(0, height - sab + 8) : 0;
  root.style.setProperty("--kb", `${offset}px`);
  root.classList.toggle("kb-open", height > 0);
  // Once the keyboard has landed, make sure the field being typed in isn't under it.
  if (height > 0) {
    window.setTimeout(() => {
      const el = document.activeElement;
      if (el instanceof HTMLElement && el !== document.body) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, DURATION + 20);
  }
}

/** iOS sometimes scrolls the whole page to "reveal" a focused field; the app already did. */
function pinPage() {
  const reset = () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  };
  window.addEventListener("scroll", reset, { passive: true });
  window.visualViewport?.addEventListener("scroll", reset, { passive: true });
  document.addEventListener("focusin", () => requestAnimationFrame(reset));
}

function simulate() {
  const kb = document.createElement("div");
  kb.setAttribute("aria-hidden", "true");
  kb.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${SIM_HEIGHT}px;z-index:9999;background:#2B2B2E;border-top:1px solid #3A3A3E;transform:translateY(100%);transition:transform ${DURATION}ms ${CURVE};pointer-events:none;`;
  kb.innerHTML = `<div style="display:grid;grid-template-columns:repeat(10,1fr);gap:6px;padding:10px 4px">${"QWERTYUIOPASDFGHJKLZXCVBNM".split("").map((c) => `<span style="height:42px;border-radius:5px;background:#5A5A5E;color:#fff;font:400 22px -apple-system,sans-serif;display:flex;align-items:center;justify-content:center">${c}</span>`).join("")}</div>`;
  document.body.appendChild(kb);
  const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "time"].includes((t as HTMLInputElement).type)));
  document.addEventListener("focusin", (e) => {
    if (!isField(e.target)) return;
    kb.style.transform = "translateY(0)";
    lift(SIM_HEIGHT);
  });
  document.addEventListener("focusout", (e) => {
    if (!isField(e.target)) return;
    // Moving straight to another field keeps the keyboard up.
    setTimeout(() => {
      if (isField(document.activeElement)) return;
      kb.style.transform = "translateY(100%)";
      lift(0);
    }, 0);
  });
}

export async function initKeyboard(): Promise<void> {
  root.style.setProperty("--kb-dur", `${DURATION}ms`);
  root.style.setProperty("--kb-curve", CURVE);
  const params = new URLSearchParams(location.search);
  if (!Capacitor.isNativePlatform()) {
    if (params.has("sim") && params.has("kb")) simulate();
    return;
  }
  if (Capacitor.getPlatform() !== "ios") return;
  pinPage();
  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    // The Prev/Next/Done bar adds height and nothing Navi needs.
    await Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
    await Keyboard.addListener("keyboardWillShow", (info) => lift(info.keyboardHeight));
    await Keyboard.addListener("keyboardWillHide", () => lift(0));
  } catch {
    /* plugin missing: the layout simply stays put */
  }
}
