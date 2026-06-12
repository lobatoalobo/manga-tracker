"use client";

import { useEffect } from "react";

/** Registra el service worker (necesario para que la PWA sea instalable). */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
