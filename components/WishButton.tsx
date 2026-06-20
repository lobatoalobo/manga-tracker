"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toggleWishAction } from "@/app/actions";
import ArgentinaFlag from "@/components/ArgentinaFlag";
import UsaFlag from "@/components/UsaFlag";

export interface WishEdition {
  key: string;
  publisher: string | null;
  region: string | null;
  label: string;
}

function Flag({ region }: { region: string | null }) {
  return region === "INT" ? (
    <UsaFlag className="h-2.5 w-4 rounded-[1px]" />
  ) : (
    <ArgentinaFlag className="h-2.5 w-4 rounded-[1px]" />
  );
}

/**
 * Botón "Agregar a deseados" POR EDICIÓN. Con 1 edición = toggle directo. Con
 * varias = dropdown para desear/quitar cada edición por separado (así notis y
 * "ya salió" no se mezclan).
 */
export default function WishButton({
  anilistId,
  title,
  coverImage,
  editions,
  initialWishedKeys,
}: {
  anilistId: number;
  title: string;
  coverImage: string;
  editions: WishEdition[];
  initialWishedKeys: string[];
}) {
  const [wished, setWished] = useState<Set<string>>(
    () => new Set(initialWishedKeys),
  );
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function toggle(ed: WishEdition) {
    const isW = wished.has(ed.key);
    setWished((s) => {
      const n = new Set(s);
      if (isW) n.delete(ed.key);
      else n.add(ed.key);
      return n;
    });
    start(() =>
      toggleWishAction({
        anilistId,
        title,
        coverImage,
        wished: isW,
        editionKey: ed.key,
        publisher: ed.publisher,
        region: ed.region,
      }),
    );
  }

  const btn =
    "min-w-45 rounded-lg px-4 py-2 text-center text-sm font-medium transition";
  const onCls = "bg-accent text-white";
  const offCls =
    "border border-border text-muted hover:border-accent hover:text-foreground";

  // 1 edición (o ninguna) → toggle directo.
  if (editions.length <= 1) {
    const ed: WishEdition = editions[0] ?? {
      key: "",
      publisher: null,
      region: null,
      label: "",
    };
    const isW = wished.has(ed.key);
    return (
      <button onClick={() => toggle(ed)} className={`${btn} ${isW ? onCls : offCls}`}>
        {isW ? "★ En deseados" : "☆ Agregar a deseados"}
      </button>
    );
  }

  // Varias ediciones → dropdown por edición.
  const anyW = editions.some((e) => wished.has(e.key));
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`${btn} ${anyW ? onCls : offCls}`}
      >
        {anyW ? "★ En deseados" : "☆ Agregar a deseados"} ▾
      </button>
      {open && (
        <div className="absolute z-40 mt-2 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          <p className="px-3 py-1 text-xs text-muted">Elegí la edición</p>
          {editions.map((ed) => {
            const isW = wished.has(ed.key);
            return (
              <button
                key={ed.key}
                onClick={() => toggle(ed)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-surface-2"
              >
                <span className="flex items-center gap-1.5">
                  <Flag region={ed.region} /> {ed.label}
                </span>
                <span className={isW ? "text-accent" : "text-muted"}>
                  {isW ? "★ Deseada" : "☆"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
