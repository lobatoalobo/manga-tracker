import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nakama — tu colección de manga",
    short_name: "Nakama",
    description: "Seguí y organizá tu colección de manga en Argentina.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0d12",
    theme_color: "#0d0d12",
    lang: "es-AR",
    icons: [
      { src: "/icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
