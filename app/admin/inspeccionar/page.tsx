import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { inspectSeries } from "@/lib/inspect";
import { EDITIONS_CACHE_VERSION } from "@/lib/getMangaDetails";

export const metadata = { title: "Inspeccionar serie (admin) · Nakama" };

export default async function InspectPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const { id } = await searchParams;
  const anilistId = Number(id);
  const data = id && Number.isFinite(anilistId) ? await inspectSeries(anilistId) : null;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Inspeccionar serie</h1>
      <p className="mb-5 text-sm text-muted">
        Datos crudos de una serie (ediciones, override de Crumb, caché) para
        debuggear sin SQL.
      </p>

      <form className="mb-6 flex gap-2" action="/admin/inspeccionar">
        <input
          name="id"
          defaultValue={id ?? ""}
          placeholder="anilistId (ej. 144946)"
          inputMode="numeric"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
          Inspeccionar
        </button>
      </form>

      {data && (
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">
                {data.title ?? "—"}{" "}
                <span className="text-sm font-normal text-muted">
                  #{data.anilistId}
                </span>
              </h2>
              <Link
                href={`/manga/${data.anilistId}`}
                target="_blank"
                className="text-xs text-accent hover:underline"
              >
                ver ficha ↗
              </Link>
            </div>
          </div>

          {/* Caché */}
          <div className="rounded-xl border border-border bg-surface p-4 text-sm">
            <h3 className="mb-2 font-medium">Caché de ediciones</h3>
            {data.cache.exists ? (
              <p className="text-muted">
                Cacheada · v{data.cache.version}
                {data.cache.version !== EDITIONS_CACHE_VERSION && (
                  <span className="text-amber-400">
                    {" "}
                    (vieja, actual v{EDITIONS_CACHE_VERSION})
                  </span>
                )}{" "}
                ·{" "}
                {data.cache.updatedAt?.toLocaleString("es-AR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            ) : (
              <p className="text-muted">Sin cachear (se resuelve en vivo).</p>
            )}
          </div>

          {/* Crumb */}
          <div className="rounded-xl border border-border bg-surface p-4 text-sm">
            <h3 className="mb-2 font-medium">Override de Crumb</h3>
            <p className="text-muted">
              {data.crumbOverride ? `"${data.crumbOverride}"` : "sin override"}
            </p>
          </div>

          {/* Ediciones */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-2 text-sm font-medium">
              PublisherEdition ({data.editions.length})
            </h3>
            {data.editions.length === 0 ? (
              <p className="text-sm text-muted">Sin ediciones mapeadas.</p>
            ) : (
              <ul className="space-y-2">
                {data.editions.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-lg border border-border bg-surface-2/40 p-2 text-sm"
                  >
                    <p className="font-medium">
                      {e.title}{" "}
                      <span className="text-xs font-normal text-muted">
                        · {e.publisher} · {e.volumes} tomos · {e.status ?? "—"}
                      </span>
                    </p>
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-xs text-accent hover:underline"
                    >
                      {e.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
