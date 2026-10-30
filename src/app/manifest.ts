import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Navi",
    short_name: "Navi",
    description: "Your AI-native personal operating system",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#2f5bd3",
    orientation: "portrait",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Capture", url: "/?capture=1" },
      { name: "Talk to Navi", url: "/chat" },
      { name: "Inbox", url: "/inbox" },
    ],
  };
}
