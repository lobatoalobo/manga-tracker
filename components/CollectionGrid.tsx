"use client";

import { useState } from "react";
import Link from "next/link";
import MangaCard from "./MangaCard";
import type { MangaView } from "@/lib/collection";

export default function CollectionGrid({
  collection,
}: {
  collection: MangaView[];
}) {
  const [search, setSearch] = useState("");

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

  const filtered = collection.filter((manga) =>
    (manga.title.romaji ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <input
        type="text"
        placeholder="Buscar en mi colección…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-2 w-full max-w-sm rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
      />

      <p className="mb-4 text-sm text-muted">{filtered.length} series</p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filtered.map((manga) => (
          <MangaCard key={manga.id} manga={manga} />
        ))}
      </div>
    </>
  );
}
