import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";

// If anything fails at start-up, show what happened instead of a black screen.
function Failed({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#fff", padding: "80px 24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>Navi couldn't start</h1>
      <p style={{ opacity: 0.7, lineHeight: 1.5, margin: 0 }}>Close the app and open it again. If this keeps happening, send this to the developer:</p>
      <pre style={{ whiteSpace: "pre-wrap", opacity: 0.6, fontSize: 13, marginTop: 16 }}>{msg}</pre>
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
