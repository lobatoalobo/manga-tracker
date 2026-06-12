"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useBrowse } from "./BrowseProvider";
import { EDITORIALS } from "@/lib/catalog";

type Tab = "hot" | "az" | "mangaka" | "editoriales";

const MODES: { key: Tab; label: string }[] = [
  { key: "hot", label: "🔥 Hot" },
  { key: "az", label: "A-Z" },
  { key: "mangaka", label: "Mangakas" },
  { key: "editoriales", label: "Editoriales" },
];

/**
 * Barra de descubrimiento compartida (vive en el layout, así no se desmonta al
 * abrir una serie). El buscador filtra la sección actual (mangakas/editoriales)
 * al instante, o busca en AniList en Hot/A-Z y en la ficha.
 */
export default function DiscoveryBar() {
  const browse = useBrowse();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const onHome = pathname === "/";
  const search = params.get("search") ?? "";
  const tab = (params.get("tab") as Tab) || "hot";
  const ed = params.get("ed") ?? EDITORIALS[0].slug;

  const filterMode =
    onHome && !search && (tab === "mangaka" || tab === "editoriales");

  // Sincroniza el filtro compartido con la navegación: muestra el query en una
  // búsqueda; limpia el filtro al cambiar de modo/editorial.
  useEffect(() => {
    browse?.setQ(search);
  }, [search, tab, ed, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const [local, setLocal] = useState(search);
  const value = browse ? browse.q : local;

  function onChange(v: string) {
    browse ? browse.setQ(v) : setLocal(v);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (filterMode) return; // en modo filtro es instantáneo, no navega
    const q = value.trim();
    if (q) router.push(`/?search=${encodeURIComponent(q)}`);
  }

  const edLabel =
    EDITORIALS.find((x) => x.slug === ed)?.label ?? "editorial";
  const placeholder = filterMode
    ? tab === "editoriales"
      ? `Filtrar en ${edLabel}…`
      : "Filtrar mangakas…"
    : "Buscar manga…";

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="flex max-w-xl gap-2">
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
        />
        {!filterMode && (
          <button
            type="submit"
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Buscar
          </button>
        )}
      </form>

      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-surface-2 p-1">
        {MODES.map((m) => {
          const active = onHome && !search && tab === m.key;
          return (
            <Link
              key={m.key}
              href={`/?tab=${m.key}`}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-accent text-white"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {m.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
