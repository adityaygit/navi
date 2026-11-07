// Navi for Windows and Mac: a window onto the Navi web app, with the things a
// desktop app needs (one instance, remembered window size, microphone only for
// Navi, links to other sites in the person's own browser, an offline screen).
// No secrets live here: the AI keys and the database stay on the server.
const { app, BrowserWindow, shell, session, Menu, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { classify, permissionAllowed } = require("./navigation");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
// NAVI_APP_URL overrides the built-in address (e.g. a local server during development).
const APP_URL = process.env.NAVI_APP_URL || config.url;
const SUPABASE_URL = process.env.NAVI_SUPABASE_URL || config.supabaseUrl || null;

nativeTheme.themeSource = "dark";
// Lets the server tell the desktop app apart (e.g. open sign-in, not the marketing page).
app.userAgentFallback = `${app.userAgentFallback} NaviDesktop/${app.getVersion()}`;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  const boundsFile = () => path.join(app.getPath("userData"), "window.json");
  const readBounds = () => {
    try {
      return JSON.parse(fs.readFileSync(boundsFile(), "utf8"));
    } catch {
      return null;
    }
  };

  function createWindow() {
    const saved = readBounds();
    win = new BrowserWindow({
      width: saved?.width ?? 1360,
      height: saved?.height ?? 860,
      x: saved?.x,
      y: saved?.y,
      minWidth: 1024,
      minHeight: 640,
      backgroundColor: "#000000",
      title: "Navi",
      show: false,
      // Mac: traffic lights over the black page, like other modern Mac apps.
      ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 14 } } : {}),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
      },
    });
    if (saved?.maximized) win.maximize();
    win.once("ready-to-show", () => win.show());

    const save = () => {
      if (!win || win.isDestroyed()) return;
      try {
        fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
      } catch {}
    };
    win.on("close", save);

    // Links: Navi's own pages stay here; everything else opens in the default browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (classify(url, APP_URL, SUPABASE_URL) === "external") void shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
      const where = classify(url, APP_URL, SUPABASE_URL);
      if (where === "app") return;
      event.preventDefault();
      if (where === "external") void shell.openExternal(url);
    });

    // No connection (or the server is down): a calm local screen with a retry.
    win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* aborted by a redirect */) return;
      void win.loadFile(path.join(__dirname, "offline.html"), { query: { retry: url || APP_URL } });
    });

    void win.loadURL(APP_URL);
  }

  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    // Microphone (voice) and notifications only for Navi itself.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      callback(permissionAllowed(permission, details.requestingUrl || wc.getURL(), APP_URL));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permissionAllowed(permission, origin, APP_URL));

    // Standard menus (copy/paste, zoom, reload). Mac needs an app menu.
    const template = [
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      { role: "editMenu" },
      { label: "View", submenu: [{ role: "reload" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
      { role: "windowMenu" },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
