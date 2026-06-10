"use client";

import { useMemo, useState } from "react";
import { externalHref } from "@/lib/url";

export interface StoreItem {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  phone: string | null;
  hours: string | null;
  website: string | null;
  social: string | null;
}

export default function StoreList({ stores }: { stores: StoreItem[] }) {
  const [search, setSearch] = useState("");
  const [province, setProvince] = useState("all");

  const provinces = useMemo(
    () => [...new Set(stores.map((s) => s.province).filter(Boolean))].sort(),
    [stores],
  );

  const filtered = stores.filter((s) => {
    const q = search.toLowerCase();
    const matchSearch =
      s.name.toLowerCase().includes(q) ||
      (s.city ?? "").toLowerCase().includes(q) ||
      (s.address ?? "").toLowerCase().includes(q);
    const matchProvince = province === "all" || s.province === province;
    return matchSearch && matchProvince;
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Buscar por nombre, barrio o dirección…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-56 flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm outline-none focus:border-accent"
        />
        <select
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="all">Toda provincia</option>
          {provinces.map((p) => (
            <option key={p as string} value={p as string}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted">No hay tiendas que coincidan.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <h3 className="font-semibold">{s.name}</h3>
              <p className="mt-0.5 text-sm text-muted">
                {[s.address, s.city, s.province].filter(Boolean).join(", ") ||
                  "Sin dirección"}
              </p>
              <dl className="mt-2 space-y-0.5 text-sm text-muted">
                {s.phone && <p>📞 {s.phone}</p>}
                {s.hours && <p>🕒 {s.hours}</p>}
              </dl>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {s.website && (
                  <a
                    href={externalHref(s.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    Sitio web ↗
                  </a>
                )}
                {s.social && (
                  <a
                    href={externalHref(s.social)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    Redes ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
