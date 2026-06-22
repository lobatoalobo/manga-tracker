import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getWorksByExactAuthor } from "@/lib/authorMerge";

export const metadata = { title: "Autor (admin) · Nakama" };

/**
 * Vista admin de las obras de una grafía EXACTA de autor — TODAS las editoriales,
 * incluso las que el catálogo público no muestra (no-Ivrea/VIZ). Para verificar
 * qué hay detrás de cada variante antes de unificar. Ver /admin/autores.
 */
export default async function AdminAutorDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const { name } = await params;
  const author = decodeURIComponent(name);
  const works = await getWorksByExactAuthor(author);
  const hidden = works.filter((w) => !w.visible).length;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/admin/autores" className="text-sm text-muted hover:text-foreground">
        ← Autores a unificar
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">
        {author} <span className="text-base font-normal text-muted">· {works.length} obras</span>
      </h1>
      <p className="mb-5 text-sm text-muted">
        Grafía exacta. Incluye editoriales que el catálogo público no muestra.
        {hidden > 0 && (
          <>
            {" "}
            <b className="text-amber-300">{hidden}</b> no son visibles (editorial fuera de Ivrea/VIZ).
          </>
        )}
      </p>

      {works.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          No hay obras con esta grafía exacta.
        </p>
      ) : (
        <ul className="space-y-2">
          {works.map((w) => (
            <li key={w.id}>
              <Link
                href={`/serie/${w.id}`}
                target="_blank"
                className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 transition hover:border-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {w.coverImage ? (
                  <img src={w.coverImage} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-surface-2 text-xs text-muted">
                    s/p
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {w.title} <span className="text-xs text-muted">#{w.id}</span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                    {w.publishers.map((p) => (
                      <span key={p} className="rounded bg-surface-2 px-1.5 py-0.5 text-muted">
                        {p}
                      </span>
                    ))}
                    {!w.visible && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">
                        no visible
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
