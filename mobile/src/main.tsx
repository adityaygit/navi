import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { startKeyboard } from "./native/keyboard";

// The page follows the keyboard (iPhone) from the very first frame.
startKeyboard();

// If anything fails at start-up, show what happened instead of a blank screen (M6: light).
function Failed({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div style={{ minHeight: "100vh", boxSizing: "border-box", background: "#FBFBFD", color: "#11141A", padding: "96px 24px", fontFamily: "Figtree, -apple-system, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 34, lineHeight: 1.05, fontWeight: 700, letterSpacing: "-0.03em", margin: "0 0 14px" }}>Navi couldn't start.</h1>
      <p style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.45, color: "#2E3442", margin: 0 }}>Close the app and open it again. If this keeps happening, send this to the developer:</p>
      <pre style={{ whiteSpace: "pre-wrap", fontSize: 14, color: "#3B4252", marginTop: 18, padding: 14, borderRadius: 16, background: "#F3F5F9" }}>{msg}</pre>
    </div>
  );
}

class Guard extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    return this.state.error ? <Failed error={this.state.error} /> : this.props.children;
  }
}

const root = createRoot(document.getElementById("root")!);
import("./App")
  .then(({ App }) =>
    root.render(
      <StrictMode>
        <Guard>
          <App />
        </Guard>
      </StrictMode>,
    ),
  )
  .catch((e) => {
    void import("@capacitor/splash-screen").then((m) => m.SplashScreen.hide()).catch(() => {});
    root.render(<Failed error={e} />);
  });
