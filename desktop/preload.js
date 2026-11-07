// The only thing the web app learns about the desktop shell: that it is
// running inside it, and on which platform (for shortcut labels and features
// such as web push that a desktop shell doesn't have). No Node access.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("naviDesktop", {
  platform: process.platform, // "win32" | "darwin" | "linux"
  version: process.env.npm_package_version || null,
});
