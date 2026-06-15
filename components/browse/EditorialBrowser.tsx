"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useBrowse } from "./BrowseProvider";
import { ClientPager } from "@/components/MangakaBrowser";
import type { EditorialWork } from "@/lib/catalog";

const PER_PAGE = 30;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Catálogo de una editorial, filtrado por el buscador compartido. */
export default function EditorialBrowser({
  works,
}: {
  works: EditorialWork[];
}) {
  const browse = useBrowse();
  const q = browse?.q ?? "";
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const nq = norm(q);
    return nq ? works.filter((w) => norm(w.title).includes(nq)) : works;
  }, [q, works]);

  if (works.length === 0) {
    return (
      <p className="mt-5 text-sm text-muted">
        No hay títulos indexados para esta editorial todavía.
      </p>
    );
  }
  if (filtered.length === 0) {
    return (
      <p className="mt-5 text-sm text-muted">
        Ningún título coincide con tu búsqueda.
      </p>
    );
  }

  const lastPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const cur = Math.min(page, lastPage);
  const slice = filtered.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);

  return (
    <>
      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {slice.map((w) => (
          <Link
            key={w.id}
            href={w.anilistId ? `/manga/${w.anilistId}` : `/r/ed/${w.id}`}
            title={w.title}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2 transition hover:border-accent"
          >
            <span className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-2">
              {w.coverImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={w.coverImage}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-lg">📕</span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{w.title}</span>
              <span className="text-xs text-muted">
                {w.volumes} tomos
                {w.upcoming && (
                  <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                    🔜 Pronto
                  </span>
                )}
              </span>
            </span>
          </Link>
        ))}
      </div>
      <ClientPager page={cur} lastPage={lastPage} onPage={setPage} />
    </>
  );
}
