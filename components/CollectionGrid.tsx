"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import MangaCard from "./MangaCard";
import RemoveEditionButton from "./RemoveEditionButton";
import { displayTitle } from "@/lib/title";
import type { CollectionItem } from "@/lib/collection";

type SortKey = "title" | "progress" | "volumes";
type View = "grid" | "list";
const VIEW_KEY = "nakama:collectionView";

// Editoriales que siempre aparecen en el filtro, aunque no tengas series.
const KNOWN_PUBLISHERS = ["Ivrea Argentina", "Panini Argentina", "Ovni Press"];

function progressOf(i: CollectionItem): number {
  const t = i.edition.totalVolumes;
  return t > 0 ? i.edition.ownedVolumes.length / t : 0;
}

export default function CollectionGrid({
  items,
  readOnly = false,
  hrefBase = "/manga",
}: {
  items: CollectionItem[];
  readOnly?: boolean;
  hrefBase?: string;
}) {
  const [search, setSearch] = useState("");
  const [publisher, setPublisher] = useState("all");
  const [reading, setReading] = useState("all");
  const [sort, setSort] = useState<SortKey>("title");
  const [view, setView] = useState<View>("list");

  // La vista elegida se recuerda por dispositivo.
  useEffect(() => {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === "grid" || saved === "list") setView(saved);
  }, []);
  function changeView(v: View) {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  }

  const publishers = useMemo(() => {
    const present = items.map((i) => i.edition.label);
    return [...new Set([...KNOWN_PUBLISHERS, ...present])].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const out = items.filter((i) => {
      const matchSearch = i.title.romaji
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchPublisher =
        publisher === "all" || i.edition.label === publisher;
      const matchReading =
        reading === "all" || i.edition.readingStatus === reading;
      return matchSearch && matchPublisher && matchReading;
    });

    out.sort((a, b) => {
      if (sort === "title") return a.title.romaji.localeCompare(b.title.romaji);
      if (sort === "progress") return progressOf(b) - progressOf(a);
      return b.edition.totalVolumes - a.edition.totalVolumes;
    });

    return out;
  }, [items, search, publisher, reading, sort]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
        <p className="text-muted">Todavía no agregaste ninguna edición.</p>
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
            <option key={p} value={p}>
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

        <div className="flex overflow-hidden rounded-lg border border-border">
          <ViewBtn active={view === "grid"} onClick={() => changeView("grid")} label="Vista de tarjetas">
            ▦
          </ViewBtn>
          <ViewBtn active={view === "list"} onClick={() => changeView("list")} label="Vista de lista">
            ☰
          </ViewBtn>
        </div>
      </div>

      <p className="mb-4 text-sm text-muted">{filtered.length} ediciones</p>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-10 text-center text-sm text-muted">
          {publisher !== "all"
            ? `No tenés series de ${publisher}.`
            : "Ninguna serie coincide con los filtros."}
        </p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((i) => (
            <MangaCard
              key={`${i.anilistId}-${i.edition.key}`}
              item={i}
              readOnly={readOnly}
              hrefBase={hrefBase}
            />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {filtered.map((i) => (
            <CollectionRow
              key={`${i.anilistId}-${i.edition.key}`}
              item={i}
              readOnly={readOnly}
              hrefBase={hrefBase}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function CollectionRow({
  item,
  readOnly,
  hrefBase,
}: {
  item: CollectionItem;
  readOnly: boolean;
  hrefBase: string;
}) {
  const { edition } = item;
  const owned = edition.ownedVolumes.length;
  const total = edition.totalVolumes;
  const pct = total > 0 ? Math.floor((owned / total) * 100) : 0;
  const href =
    item.anilistId < 0
      ? `/nacional/${-item.anilistId}`
      : `${hrefBase}/${item.anilistId}`;

  return (
    <li className="flex items-center gap-3 px-3 py-2 transition hover:bg-surface-2">
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.coverImage}
          alt=""
          className="h-12 w-9 shrink-0 rounded object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {displayTitle(item.title)}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {item.upcoming && (
              <span className="text-amber-300">🔜 Pronto · </span>
            )}
            {edition.label}
            {edition.readingStatus === "READING" && " · 📖 Leyendo"}
            {edition.readingStatus === "READ" && " · ✅ Leído"}
          </p>
        </div>
        <div className="shrink-0 text-right text-xs text-muted">
          <span className="tabular-nums">
            {owned}/{total || "?"}
          </span>
          <span className="ml-2 tabular-nums">{pct}%</span>
        </div>
      </Link>
      {!readOnly && (
        <RemoveEditionButton
          anilistId={item.anilistId}
          editionKey={edition.key}
          label="✕"
          className="shrink-0 rounded-md px-2 py-1 text-xs text-muted transition hover:text-red-400"
        />
      )}
    </li>
  );
}

function ViewBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`px-3 py-2 text-sm transition ${
        active ? "bg-accent text-white" : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
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
