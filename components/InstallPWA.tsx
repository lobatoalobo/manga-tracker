"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Banner para instalar la app. En Chrome/Android captura el evento
 * `beforeinstallprompt` y muestra un botón que dispara el instalador nativo.
 * En iOS (que no soporta ese evento) muestra las instrucciones de Safari.
 */
export default function InstallPWA() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      (navigator as unknown as { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;
    if (isIOS && !standalone) setIosHint(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (dismissed) return null;
  if (!deferred && !iosHint) return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }

  return (
    <div className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-2 text-sm">
        {deferred ? (
          <>
            <span className="text-muted">📲 Instalá Nakama en tu celu</span>
            <button
              onClick={install}
              className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white transition hover:opacity-90"
            >
              Instalar
            </button>
          </>
        ) : (
          <span className="text-muted">
            📲 Para instalar: tocá <b className="text-foreground">Compartir</b> y
            luego <b className="text-foreground">“Agregar a inicio”</b>
          </span>
        )}
        <button
          onClick={() => setDismissed(true)}
          aria-label="Cerrar"
          className="ml-auto text-muted transition hover:text-foreground"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
