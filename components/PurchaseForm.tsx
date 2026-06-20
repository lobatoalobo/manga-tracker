"use client";

import { useState, useTransition } from "react";
import { addPurchaseAction, updatePurchaseAction } from "@/app/actions";
import PurchaseSeriesPicker, {
  type SeriesValue,
} from "@/components/PurchaseSeriesPicker";
import {
  PURCHASE_STATUS_META,
  PURCHASE_STATUS_ORDER,
} from "@/lib/purchaseStatus";

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

export interface InitialPurchase {
  id: number;
  store: string;
  purchasedAt: string; // yyyy-mm-dd
  note: string;
  discount: number;
  items: {
    id: number;
    title: string;
    anilistId: number | null;
    coverImage: string | null;
    volume: number | null;
    edition: string | null;
    price: number;
  }[];
}

interface ItemRow {
  id?: number;
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

function rowsFrom(initial?: InitialPurchase): ItemRow[] {
  if (!initial || initial.items.length === 0) return [emptyItem()];
  return initial.items.map((i) => ({
    id: i.id,
    series: {
      title: i.title,
      anilistId: i.anilistId,
      coverImage: i.coverImage,
      publisher: i.edition ?? null,
    },
    volume: i.volume != null ? String(i.volume) : "",
    edition: i.edition ?? "",
    price: String(i.price),
  }));
}

export default function PurchaseForm({
  initial,
  onClose,
}: {
  initial?: InitialPurchase;
  onClose?: () => void;
}) {
  const editing = !!initial;
  const [open, setOpen] = useState(editing);
  const [store, setStore] = useState(initial?.store ?? "");
  const [status, setStatus] = useState("RECEIVED");
  const [date, setDate] = useState(initial?.purchasedAt ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [discount, setDiscount] = useState(
    initial?.discount ? String(initial.discount) : "",
  );
  const [addToCollection, setAddToCollection] = useState(true);
  const [items, setItems] = useState<ItemRow[]>(rowsFrom(initial));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setStore("");
    setStatus("RECEIVED");
    setDate("");
    setNote("");
    setDiscount("");
    setAddToCollection(true);
    setItems([emptyItem()]);
    setError(null);
  }

  function setItem(i: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }

  const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
  const disc = Math.min(100, Math.max(0, Number(discount) || 0));
  const total = subtotal * (1 - disc / 100);
  const saved = subtotal - total;

  function submit() {
    setError(null);
    const cleanItems = items
      .filter((it) => it.series.title.trim() && it.price !== "")
      .map((it) => ({
        id: it.id,
        title: it.series.title,
        anilistId: it.series.anilistId,
        coverImage: it.series.coverImage,
        volume: it.volume ? Number(it.volume) : null,
        edition: it.series.publisher ?? (it.edition || null),
        price: Number(it.price),
      }));
    if (cleanItems.length === 0) {
      setError("Agregá al menos un tomo con precio.");
      return;
    }
    startTransition(async () => {
      const discountNum = discount ? Number(discount) : 0;
      const res = editing
        ? await updatePurchaseAction(initial!.id, {
            store,
            purchasedAt: date || null,
            note,
            discount: discountNum,
            addToCollection,
            items: cleanItems,
          })
        : await addPurchaseAction({
            store,
            status,
            purchasedAt: date || null,
            note,
            discount: discountNum,
            addToCollection,
            items: cleanItems,
          });
      if (res?.ok) {
        if (editing) {
          onClose?.();
        } else {
          reset();
          setOpen(false);
        }
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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
        <div className="relative">
          <input
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            type="number"
            min={0}
            max={100}
            placeholder="Descuento"
            className={input}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
            %
          </span>
        </div>
        {editing ? (
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nota (opcional)"
            className={input}
          />
        ) : (
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
        )}
      </div>

      {/* Tomos */}
      <div className="mt-4 space-y-3">
        {items.map((it, i) => (
          <div
            key={it.id ?? `new-${i}`}
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
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={it.volume}
                  onChange={(e) => setItem(i, { volume: e.target.value })}
                  type="number"
                  min={0}
                  placeholder="Tomo #"
                  className={input}
                />
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
              {(() => {
                const total = it.series.volumes ?? 0;
                const v = Number(it.volume) || 0;
                return total > 0 && v > total ? (
                  <p className="text-xs text-amber-400">
                    ⚠️ La edición tiene {total} tomo{total === 1 ? "" : "s"}. ¿Es
                    correcto el tomo #{v}?
                  </p>
                ) : null;
              })()}
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
        {editing
          ? "Agregar los tomos nuevos a mi colección"
          : "Agregar los tomos a mi colección"}
      </label>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-muted">
          {disc > 0 ? (
            <>
              <span className="line-through">{ars.format(subtotal)}</span> ·{" "}
              <span className="font-semibold text-foreground">
                {ars.format(total)}
              </span>{" "}
              <span className="text-emerald-400">
                (−{ars.format(saved)})
              </span>
            </>
          ) : (
            <>
              Total:{" "}
              <span className="font-semibold text-foreground">
                {ars.format(total)}
              </span>
            </>
          )}
        </span>
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={pending}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {pending
              ? "Guardando…"
              : editing
                ? "Guardar cambios"
                : "Guardar compra"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (editing) {
                onClose?.();
              } else {
                reset();
                setOpen(false);
              }
            }}
            className="rounded-lg border border-border px-4 py-1.5 text-sm text-muted transition hover:text-foreground"
          >
            {editing ? "Cancelar" : "Cerrar"}
          </button>
        </div>
      </div>
    </div>
  );
}
