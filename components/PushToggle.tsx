"use client";

import { useEffect, useState } from "react";
import {
  subscribePushAction,
  unsubscribePushAction,
  testPushAction,
} from "@/app/actions";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function PushToggle() {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupported(false);
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, []);

  async function enable() {
    if (!VAPID) {
      setMsg("Faltan configurar las claves VAPID.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setMsg("Permiso denegado en el navegador.");
        setBusy(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID),
      });
      const json = sub.toJSON();
      await subscribePushAction({
        endpoint: json.endpoint as string,
        keys: {
          p256dh: json.keys?.p256dh as string,
          auth: json.keys?.auth as string,
        },
      });
      setSubscribed(true);
      await testPushAction();
      setMsg("✓ Activadas. Te mandamos una de prueba.");
    } catch {
      setMsg("No se pudieron activar.");
    }
    setBusy(false);
  }

  async function disable() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePushAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMsg("Desactivadas en este dispositivo.");
    } catch {
      setMsg("No se pudieron desactivar.");
    }
    setBusy(false);
  }

  if (!supported)
    return (
      <p className="text-sm text-muted">
        Tu navegador no soporta notificaciones push.
      </p>
    );

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Notificaciones push</p>
          <p className="mt-0.5 text-xs text-muted">
            Recibí avisos en este dispositivo aunque la app esté cerrada
            (respeta los toggles de arriba).
          </p>
        </div>
        <button
          onClick={subscribed ? disable : enable}
          disabled={busy}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
            subscribed
              ? "border border-border text-muted hover:border-red-500 hover:text-red-400"
              : "bg-accent text-white hover:opacity-90"
          }`}
        >
          {busy
            ? "…"
            : subscribed
              ? "Desactivar en este dispositivo"
              : "Activar push"}
        </button>
      </div>
      {msg && <p className="mt-3 text-sm text-muted">{msg}</p>}
    </div>
  );
}
