import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { getSetting } from "./settings";

// One vocabulary of feels, named by moment, so every screen vibrates the same
// way for the same kind of thing. M6 rules (docs/navi-1.5/mobile/DESIGN_M6.md):
// moving around is silent, weight follows cost, you feel the line, and you
// hold when a slip costs something.
export type Feel =
  | "pageCross" // a page swipe passes the halfway point
  | "pageSettle" // a page lands
  | "select" // segmented switch, day picker, toggles
  | "holdStart" // finger down on Talk
  | "holdRamp" // while Talk is held, rising
  | "voiceOn" // voice mode opens
  | "tapHint" // Talk tapped without holding
  | "send" // a message goes
  | "success" // approve, add, task ticked, focus finished
  | "undo"
  | "warning" // end early, delete, overlap
  | "count" // focus countdown 3, 2, 1
  | "go" // focus starts
  | "sheet" // a sheet passes its dismiss point
  | "holdDone" // a hold completes inside Navi
  | "commit" // a held approval leaves Navi (text sent, class cancelled)
  | "end"; // voice or a session ends

const native = Capacitor.isNativePlatform();
let lastAt = 0;

async function run(feel: Feel) {
  if (feel === "tapHint") {
    // Double tick: "this needs a hold".
    await Haptics.selectionChanged();
    await new Promise((r) => setTimeout(r, 70));
    return Haptics.selectionChanged();
  }
  switch (feel) {
    case "pageCross":
    case "select":
    case "holdStart":
    case "holdRamp":
      return Haptics.selectionChanged();
    case "pageSettle":
    case "send":
    case "undo":
    case "count":
    case "sheet":
      return Haptics.impact({ style: ImpactStyle.Light });
    case "end":
      return Haptics.impact({ style: ImpactStyle.Light });
    case "voiceOn":
    case "holdDone":
      return Haptics.impact({ style: ImpactStyle.Medium });
    case "go":
    case "commit":
      return Haptics.impact({ style: ImpactStyle.Heavy });
    case "success":
      return Haptics.notification({ type: NotificationType.Success });
    case "warning":
      return Haptics.notification({ type: NotificationType.Warning });
  }
}

/** Fire a feel. Never throws, never blocks; quiet on the web and when switched off. */
export function feel(f: Feel): void {
  if (!native || !getSetting("haptics")) return;
  // Selection ticks closer than 40 ms apart blur into a buzz; drop the extras.
  const now = performance.now();
  if ((f === "holdRamp" || f === "pageCross" || f === "select" || f === "sheet") && now - lastAt < 40) return;
  lastAt = now;
  void run(f).catch(() => {});
}
