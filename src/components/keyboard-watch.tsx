"use client";
import { useEffect } from "react";

/**
 * Phones: notices when the on-screen keyboard is up (the visual viewport
 * shrinks while a text field has focus) and marks <html data-kb="open">,
 * exposing the visible height as --vvh. CSS uses that to hide the dock and
 * fit chat into the space above the keyboard.
 */
export function KeyboardWatch() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = document.activeElement;
        const typing = !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "range"].includes((el as HTMLInputElement).type)) || (el as HTMLElement).isContentEditable);
        const open = typing && window.innerHeight - vv.height > 120;
        root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
        if (open) root.dataset.kb = "open";
        else delete root.dataset.kb;
        // iOS scrolls the page to reveal the field; chat is already sized to fit, so keep it pinned.
        if (open && document.querySelector(".chat-shell") && window.scrollY !== 0) window.scrollTo(0, 0);
      });
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      delete root.dataset.kb;
    };
  }, []);
  return null;
}
