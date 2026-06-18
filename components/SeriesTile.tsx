import Link from "next/link";
import type { ReactNode } from "react";
import ArgentinaFlag from "@/components/ArgentinaFlag";
import { formatProximaDate, formatReleaseLabel } from "@/lib/releaseDate";

export interface SeriesTileData {
  href: string;
  title: string;
  coverImage: string | null;
  national?: boolean;
  publishers?: string[]; // si se pasa, se muestra la línea de editorial
  next?: { volume: number | null; date: string | Date } | null;
  upcoming?: boolean;
  releaseLabel?: string | null;
}

/**
 * Card de serie estándar del catálogo. Se usa en /catalogo, /deseados, /autores
 * y donde haga falta, para una vista consistente: portada (2:3), badges (🇦🇷,
 * ✓ tengo, 📅 próximo tomo / 🔜 próximo a salir), título y editorial. `overlay`
 * es para un botón flotante propio (corazón de deseados, quitar, etc.).
 */
export default function SeriesTile({
  data,
  owned = false,
  wished = false,
  overlay,
}: {
  data: SeriesTileData;
  owned?: boolean;
  wished?: boolean;
  overlay?: ReactNode;
}) {
  const wishedFlag = !owned && wished;
  return (
    <div className="relative">
      <Link
        href={data.href}
        className={`block rounded-xl border bg-surface p-2 transition hover:border-accent ${
          owned
            ? "border-accent/70 ring-1 ring-accent/40"
            : wishedFlag
              ? "border-rose-400/60 ring-1 ring-rose-400/30"
              : "border-border"
        }`}
      >
        <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-surface-2">
          {data.coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.coverImage}
              alt={data.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted">
              {data.title}
            </div>
          )}
          {data.national && (
            <span className="absolute left-1 top-1 flex items-center rounded bg-black/60 px-1 py-0.5">
              <ArgentinaFlag className="h-2.5 w-4 rounded-[1px]" />
            </span>
          )}
          {owned && (
            <span className="absolute right-1 top-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
              ✓
            </span>
          )}
          {data.next ? (
            <span className="absolute bottom-1 left-1 right-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-center text-[10px] font-medium text-white">
              📅 {data.next.volume ? `#${data.next.volume} · ` : ""}
              {formatProximaDate(new Date(data.next.date))}
            </span>
          ) : data.upcoming && !owned ? (
            <span className="absolute bottom-1 left-1 right-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-center text-[10px] font-medium text-white">
              🔜 {formatReleaseLabel(data.releaseLabel ?? null) ?? "Próximo a salir"}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm font-medium">{data.title}</p>
        {data.publishers !== undefined && (
          <p className="truncate text-xs text-muted">
            {data.publishers.length ? data.publishers.join(" · ") : "Ivrea Argentina"}
          </p>
        )}
      </Link>
      {overlay}
    </div>
  );
}
