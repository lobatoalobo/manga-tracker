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
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
