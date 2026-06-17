"use client";

import { useState, useTransition } from "react";
import { setNotifPrefAction } from "@/app/actions";
import type { NotifPrefs } from "@/lib/notificationPrefs";

const ROWS: { key: keyof NotifPrefs; label: string; desc: string }[] = [
  {
    key: "newVolume",
    label: "Tomos nuevos",
    desc: "Cuando sale un tomo de una serie que coleccionás.",
  },
  {
    key: "reissue",
    label: "Reediciones",
    desc: "Cuando reeditan un tomo agotado que te falta.",
  },
  {
    key: "wishlist",
    label: "Novedades de tus deseados",
    desc: "Cuando una serie que deseás sale en edición argentina.",
  },
  {
    key: "social",
    label: "Reacciones y comentarios",
    desc: "Cuando alguien reacciona o comenta tu actividad.",
  },
  {
    key: "friends",
    label: "Amigos",
    desc: "Solicitudes de amistad y cuando te aceptan.",
  },
];

export default function NotifPrefsToggles({ initial }: { initial: NotifPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [pending, start] = useTransition();

  function toggle(key: keyof NotifPrefs) {
    const value = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: value })); // optimista
    start(() => setNotifPrefAction(key, value));
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {ROWS.map((r) => (
        <li
          key={r.key}
          className="flex items-center justify-between gap-4 p-4"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{r.label}</p>
            <p className="mt-0.5 text-xs text-muted">{r.desc}</p>
          </div>
          <button
            role="switch"
            aria-checked={prefs[r.key]}
            aria-label={r.label}
            disabled={pending}
            onClick={() => toggle(r.key)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
              prefs[r.key] ? "bg-accent" : "bg-surface-2"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                prefs[r.key] ? "left-[1.375rem]" : "left-0.5"
              }`}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
