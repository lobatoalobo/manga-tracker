"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { lookupWorkAction, mergeWorksAction } from "@/app/actions";

interface WorkPreview {
  id: number;
  title: string;
  anilistId: number | null;
  coverImage: string | null;
  editions: { publisher: string; volumes: number }[];
  collection: number;
  wishlist: number;
}

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * Fusión manual de dos series que el detector automático no agarra (no comparten
 * anilistId, p. ej. una local de VIZ + una de Ivrea con la misma obra). Pegás
 * los dos id/URL, confirmás que son la misma y elegís cuál conservar. Reusa
 * mergeWorksAction (el mismo backend que la cola automática).
 */
export default function ManualMerge() {
  const router = useRouter();
  const [a, setA] = useState<WorkPreview | null>(null);
  const [b, setB] = useState<WorkPreview | null>(null);
  const [keep, setKeep] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, start] = useTransition();

  async function lookup(value: string, slot: "a" | "b") {
    if (!value.trim()) {
      slot === "a" ? setA(null) : setB(null);
      return;
    }
    setErr(null);
    setLoading(true);
    const r = await lookupWorkAction(value);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
      slot === "a" ? setA(null) : setB(null);
      return;
    }
    if (slot === "a") setA(r.work);
    else setB(r.work);
    // Default: conservar la que tiene anilistId (canónica / mejor ficha).
    const other = slot === "a" ? b : a;
    const both = slot === "a" ? [r.work, other] : [other, r.work];
    const withAnilist = both.find((w) => w && w.anilistId != null);
    setKeep(withAnilist ? withAnilist.id : r.work.id);
  }

  function merge() {
    if (!a || !b || keep == null) return;
    if (a.id === b.id) {
      setErr("Son la misma serie (mismo id).");
      return;
    }
    const target = keep;
    const source = keep === a.id ? b.id : a.id;
    if (
      !confirm(
        `Fusionar #${source} dentro de #${target}? Se mueven las ediciones y se borra #${source}. No se puede deshacer.`,
      )
    )
      return;
    start(async () => {
      await mergeWorksAction(source, target);
      setA(null);
      setB(null);
      setKeep(null);
      setErr(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">Fusión manual</h2>
      <p className="mb-3 mt-0.5 text-xs text-muted">
        Para series que son la misma pero no comparten anilistId (no salen en la
        cola de abajo). Pegá el id o la URL <span className="font-mono">/serie/&lt;id&gt;</span> de cada una.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Slot label="Serie A" preview={a} onLookup={(v) => lookup(v, "a")} keep={keep} setKeep={setKeep} />
        <Slot label="Serie B" preview={b} onLookup={(v) => lookup(v, "b")} keep={keep} setKeep={setKeep} />
      </div>

      {err && <p className="mt-2 text-xs text-rose-400">✗ {err}</p>}
      {loading && <p className="mt-2 text-xs text-muted">Buscando…</p>}

      {a && b && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={merge}
            disabled={pending || keep == null}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Fusionar en #{keep}
          </button>
          <span className="text-xs text-muted">
            la elegida se conserva; la otra se borra tras mover sus ediciones
          </span>
        </div>
      )}
    </div>
  );
}

function Slot({
  label,
  preview,
  onLookup,
  keep,
  setKeep,
}: {
  label: string;
  preview: WorkPreview | null;
  onLookup: (value: string) => void;
  keep: number | null;
  setKeep: (id: number) => void;
}) {
  const [val, setVal] = useState("");
  return (
    <div>
      <label className="text-xs text-muted">{label}</label>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => onLookup(val)}
        onKeyDown={(e) => e.key === "Enter" && onLookup(val)}
        placeholder="2411 o /serie/2411"
        className={`mt-1 ${input}`}
      />
      {preview && (
        <button
          type="button"
          onClick={() => setKeep(preview.id)}
          className={`mt-2 block w-full rounded-lg border p-2.5 text-left transition ${
            keep === preview.id ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
          }`}
        >
          <span className="flex items-start gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview.coverImage && (
              <img src={preview.coverImage} alt="" className="h-12 w-8 shrink-0 rounded object-cover" />
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{preview.title}</span>
              <span className="block text-xs text-muted">
                #{preview.id} · {preview.anilistId ? `anilist ${preview.anilistId}` : "local"}
              </span>
              <span className="block truncate text-xs text-muted">
                {preview.editions.map((e) => `${e.publisher} (${e.volumes}t)`).join(" · ") || "sin ediciones"}
              </span>
              {(preview.collection > 0 || preview.wishlist > 0) && (
                <span className="mt-0.5 block text-xs text-amber-300">
                  {preview.collection} colección · {preview.wishlist} deseados
                </span>
              )}
            </span>
          </span>
          <span className="mt-1.5 block text-xs font-medium text-accent">
            {keep === preview.id ? "✓ Conservar esta" : "Conservar esta"}
          </span>
        </button>
      )}
    </div>
  );
}
