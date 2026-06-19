"use client";

import { useEffect, useRef, useState } from "react";
import { searchPurchaseSeriesAction } from "@/app/actions";
import ArgentinaFlag from "@/components/ArgentinaFlag";
import UsaFlag from "@/components/UsaFlag";

export interface SeriesValue {
  title: string;
  anilistId: number | null;
  coverImage: string | null;
  publisher?: string | null; // editorial elegida (de la entrada por edición)
}

type Result = {
  id: number;
  title: string;
  coverImage: string | null;
  publisher: string | null;
  label: string;
  intl: boolean;
};

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * Autocompletar de series sobre AniList. Permite elegir una serie (linkea
 * anilistId + portada, para badge/auto-colección) o dejar texto libre.
 */
export default function PurchaseSeriesPicker({
  value,
  onChange,
}: {
  value: SeriesValue;
  onChange: (v: SeriesValue) => void;
}) {
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const q = value.title.trim();
      if (value.anilistId || q.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      const r = await searchPurchaseSeriesAction(q).catch(() => []);
      setResults(r);
      setLoading(false);
      setOpen(true);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.title, value.anilistId]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2">
        {value.coverImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value.coverImage}
            alt=""
            className="h-9 w-7 shrink-0 rounded object-cover"
          />
        )}
        <input
          value={value.title}
          onChange={(e) =>
            onChange({
              title: e.target.value,
              anilistId: null,
              coverImage: null,
              publisher: null,
            })
          }
          onFocus={() => results.length && setOpen(true)}
          placeholder="Serie / título *"
          className={input}
        />
        {value.publisher && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs text-muted">
            {/viz/i.test(value.publisher) ? (
              <UsaFlag className="h-2.5 w-4 rounded-[1px]" />
            ) : (
              <ArgentinaFlag className="h-2.5 w-4 rounded-[1px]" />
            )}
            {/viz/i.test(value.publisher)
              ? "VIZ"
              : value.publisher.replace(" Argentina", "")}
          </span>
        )}
      </div>

      {open && (loading || results.length > 0) && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-surface shadow-lg">
          {loading && (
            <li className="px-3 py-2 text-xs text-muted">Buscando…</li>
          )}
          {results.map((r, i) => (
            <li key={`${r.id}-${r.publisher ?? "x"}-${i}`}>
              <button
                type="button"
                onClick={() => {
                  onChange({
                    title: r.title,
                    anilistId: r.id,
                    coverImage: r.coverImage,
                    publisher: r.publisher,
                  });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
              >
                {r.coverImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.coverImage}
                    alt=""
                    className="h-9 w-7 shrink-0 rounded object-cover"
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                {r.publisher && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                    {r.intl ? (
                      <UsaFlag className="h-2.5 w-4 rounded-[1px]" />
                    ) : (
                      <ArgentinaFlag className="h-2.5 w-4 rounded-[1px]" />
                    )}
                    {r.intl ? "VIZ" : r.publisher.replace(" Argentina", "")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
