"use client";

import { useState, useTransition } from "react";
import { addPurchaseAction } from "@/app/actions";
import PurchaseSeriesPicker, {
  type SeriesValue,
} from "@/components/PurchaseSeriesPicker";
import {
  PURCHASE_STATUS_META,
  PURCHASE_STATUS_ORDER,
} from "@/lib/purchaseStatus";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

// Editoriales argentinas frecuentes para el dropdown del tomo.
const EDITORIAL_OPTIONS = [
  "Ivrea",
  "Panini",
  "Ovni Press",
  "Distrito Manga",
  "Kemuri",
  "Utopía",
];

interface ItemRow {
  series: SeriesValue;
  volume: string;
  edition: string;
  price: string;
}

const emptyItem = (): ItemRow => ({
  series: { title: "", anilistId: null, coverImage: null },
  volume: "",
  edition: "",
  price: "",
});

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export default function PurchaseForm() {
  const [open, setOpen] = useState(false);
  const [store, setStore] = useState("");
  const [status, setStatus] = useState("RECEIVED");
  const [date, setDate] = useState("");
  const [addToCollection, setAddToCollection] = useState(true);
  const [items, setItems] = useState<ItemRow[]>([emptyItem()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setStore("");
    setStatus("RECEIVED");
    setDate("");
    setAddToCollection(true);
    setItems([emptyItem()]);
    setError(null);
  }

  function setItem(i: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }

  const total = items.reduce((s, it) => s + (Number(it.price) || 0), 0);

  function submit() {
    setError(null);
    const payload = {
      store,
      status,
      purchasedAt: date || null,
      addToCollection,
      items: items
        .filter((it) => it.series.title.trim() && it.price !== "")
        .map((it) => ({
          title: it.series.title,
          anilistId: it.series.anilistId,
          coverImage: it.series.coverImage,
          volume: it.volume ? Number(it.volume) : null,
          edition: it.edition || null,
          price: Number(it.price),
        })),
    };
    if (payload.items.length === 0) {
      setError("Agregá al menos un tomo con precio.");
      return;
    }
    startTransition(async () => {
      const res = await addPurchaseAction(payload);
      if (res?.ok) {
        reset();
        setOpen(false);
      } else {
        setError(res?.error ?? "No se pudo guardar.");
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
      >
        + Registrar compra
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      {/* Datos generales */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          value={store}
          onChange={(e) => setStore(e.target.value)}
          placeholder="Tienda (Crumb, La Revistería…)"
          className={input}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={input}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={input}
        >
          {PURCHASE_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {PURCHASE_STATUS_META[s].label}
            </option>
          ))}
        </select>
      </div>

      {/* Tomos */}
      <div className="mt-4 space-y-3">
        {items.map((it, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-surface-2/40 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium text-muted">
                Tomo {i + 1}
              </span>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setItems((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="text-xs text-muted hover:text-red-400"
                >
                  Quitar
                </button>
              )}
            </div>
            <div className="mt-2 space-y-2">
              <PurchaseSeriesPicker
                value={it.series}
                onChange={(series) => setItem(i, { series })}
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={it.volume}
                  onChange={(e) => setItem(i, { volume: e.target.value })}
                  type="number"
                  min={0}
                  placeholder="Tomo #"
                  className={input}
                />
                <select
                  value={it.edition}
                  onChange={(e) => setItem(i, { edition: e.target.value })}
                  className={input}
                >
                  <option value="">Editorial…</option>
                  {EDITORIAL_OPTIONS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
                <input
                  value={it.price}
                  onChange={(e) => setItem(i, { price: e.target.value })}
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="Precio *"
                  className={input}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setItems((prev) => [...prev, emptyItem()])}
        className="mt-2 text-sm text-accent hover:underline"
      >
        + Agregar tomo
      </button>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={addToCollection}
          onChange={(e) => setAddToCollection(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        Agregar los tomos a mi colección
      </label>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted">
          Total:{" "}
          <span className="font-semibold text-foreground">
            {ars.format(total)}
          </span>
        </span>
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={pending}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Guardando…" : "Guardar compra"}
          </button>
          <button
            type="button"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            className="rounded-lg border border-border px-4 py-1.5 text-sm text-muted transition hover:text-foreground"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
