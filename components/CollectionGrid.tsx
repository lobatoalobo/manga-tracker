"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import MangaCard from "./MangaCard";
import { getTotalVolumes } from "@/lib/getTotalVolumes";
import type { MangaView } from "@/lib/collection";

type SortKey = "title" | "progress" | "volumes";

function progressOf(m: MangaView): number {
  const total = getTotalVolumes(m);
  return total > 0 ? m.ownedVolumes.length / total : 0;
}

export default function CollectionGrid({
  collection,
}: {
  collection: MangaView[];
}) {
  const [search, setSearch] = useState("");
  const [publisher, setPublisher] = useState("all");
  const [reading, setReading] = useState("all");
  const [sort, setSort] = useState<SortKey>("title");

  const publishers = useMemo(
    () =>
      [...new Set(collection.map((m) => m.publisher).filter(Boolean))].sort(),
    [collection],
  );

  const filtered = useMemo(() => {
    const out = collection.filter((m) => {
      const matchSearch = (m.title.romaji ?? "")
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchPublisher = publisher === "all" || m.publisher === publisher;
      const matchReading = reading === "all" || m.readingStatus === reading;
      return matchSearch && matchPublisher && matchReading;
    });

    out.sort((a, b) => {
      if (sort === "title") return a.title.romaji.localeCompare(b.title.romaji);
      if (sort === "progress") return progressOf(b) - progressOf(a);
      return getTotalVolumes(b) - getTotalVolumes(a); // volumes
    });

    return out;
  }, [collection, search, publisher, reading, sort]);

  if (collection.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
        <p className="text-muted">Todavía no agregaste ningún manga.</p>
        <Link
          href="/"
          className="mt-3 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Buscar mangas
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Buscar…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-48 flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm outline-none focus:border-accent"
        />

        <Select value={publisher} onChange={setPublisher}>
          <option value="all">Toda editorial</option>
          {publishers.map((p) => (
            <option key={p} value={p as string}>
              {p}
            </option>
          ))}
        </Select>

        <Select value={reading} onChange={setReading}>
          <option value="all">Toda lectura</option>
          <option value="UNREAD">Sin empezar</option>
          <option value="READING">Leyendo</option>
          <option value="READ">Leído</option>
        </Select>

        <Select value={sort} onChange={(v) => setSort(v as SortKey)}>
          <option value="title">Orden: A-Z</option>
          <option value="progress">Orden: % completado</option>
          <option value="volumes">Orden: tomos</option>
        </Select>
      </div>

      <p className="mb-4 text-sm text-muted">{filtered.length} series</p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filtered.map((manga) => (
          <MangaCard key={manga.id} manga={manga} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted">
          Ninguna serie coincide con los filtros.
        </p>
      )}
    </>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
    >
      {children}
    </select>
  );
}
