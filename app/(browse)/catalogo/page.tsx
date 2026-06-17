import Link from "next/link";
import { browseWorks } from "@/lib/catalog";
import { formatProximaDate } from "@/lib/releaseDate";

export const metadata = { title: "Catálogo · Nakama" };

/**
 * Browse/búsqueda del catálogo LOCAL (`Work`), sin AniList. Lee todo de nuestra
 * DB y linkea a /serie/[workId]. Parte del read-path local (paso 2 del rebuild,
 * ver docs/plan-catalogo-local.md). Convive con la home de AniList hasta que
 * apaguemos AniList.
 */
export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const tab = sp.tab === "proximos" ? "proximos" : "az";
  const works = await browseWorks({ q, tab, take: 80 });

  const tabHref = (t: string) =>
    `/catalogo?tab=${t}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="mb-4 text-2xl font-bold">Catálogo</h1>

      <form action="/catalogo" className="mb-3 flex gap-2">
        {tab === "proximos" && <input type="hidden" name="tab" value="proximos" />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar obra…"
          className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90">
          Buscar
        </button>
      </form>

      <div className="mb-5 flex gap-2 text-sm">
        {[
          { t: "az", label: "A-Z" },
          { t: "proximos", label: "🔜 Próximos" },
        ].map(({ t, label }) => (
          <Link
            key={t}
            href={tabHref(t)}
            className={`rounded-full px-3 py-1 transition ${
              tab === t
                ? "bg-accent text-white"
                : "bg-surface-2 text-muted hover:text-foreground"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {works.length === 0 ? (
        <p className="text-sm text-muted">
          {q ? `Sin resultados para "${q}".` : "No hay obras."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {works.map((w) => (
            <Link
              key={w.id}
              href={`/serie/${w.id}`}
              className="group rounded-xl border border-border bg-surface p-2 transition hover:border-accent"
            >
              <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-2">
                {w.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={w.coverImage}
                    alt={w.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted">
                    {w.title}
                  </div>
                )}
                {w.next && (
                  <span className="absolute bottom-1 left-1 right-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-center text-[10px] font-medium text-white">
                    📅 {w.next.volume ? `#${w.next.volume} · ` : ""}
                    {formatProximaDate(w.next.date)}
                  </span>
                )}
                {!w.next && w.upcoming && (
                  <span className="absolute bottom-1 left-1 right-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-center text-[10px] font-medium text-white">
                    🔜 Próximo a salir
                  </span>
                )}
              </div>
              <p className="mt-1.5 line-clamp-2 text-sm font-medium">{w.title}</p>
              <p className="text-xs text-muted">{w.publishers.join(" · ")}</p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
