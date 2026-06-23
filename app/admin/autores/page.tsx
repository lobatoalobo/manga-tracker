import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getAuthorVariantClusters, getWorksMissingAuthor } from "@/lib/authorMerge";
import AuthorMerge from "@/components/AuthorMerge";
import AuthorFix from "@/components/AuthorFix";

export const metadata = { title: "Autores (admin) · Nakama" };

/**
 * Herramientas de autores, en dos pestañas:
 *  - Unificar: grafías distintas del mismo mangaka (orden/mayúsculas).
 *  - Sin autor: series a las que les falta el autor, para completarlo a mano.
 */
export default async function AdminAutoresPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const tab = (await searchParams).tab === "sin-autor" ? "sin-autor" : "unificar";
  const [clusters, missing] = await Promise.all([
    getAuthorVariantClusters(),
    getWorksMissingAuthor(),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/admin" className="text-sm text-muted hover:text-foreground">
        ← Admin
      </Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold">Autores</h1>

      <div className="mb-6 flex gap-2 border-b border-border">
        <Tab href="/admin/autores" active={tab === "unificar"} label="A unificar" count={clusters.length} />
        <Tab
          href="/admin/autores?tab=sin-autor"
          active={tab === "sin-autor"}
          label="Sin autor"
          count={missing.length}
        />
      </div>

      {tab === "unificar" ? (
        <>
          <p className="mb-5 text-sm text-muted">
            Grafías distintas del mismo autor (orden nombre/apellido y mayúsculas).
            Elegí una variante o editá el campo, y <b>Unificá</b> — reescribe el autor
            en todas las obras. La sugerencia es la grafía más usada en Title Case.
          </p>
          <AuthorMerge clusters={clusters} />
        </>
      ) : (
        <>
          <p className="mb-5 text-sm text-muted">
            Series sin autor cargado. Abrí la ficha (<b>Ver</b>) para chequear la
            fuente, escribí el autor y <b>Guardá</b>: queda bloqueado para que ningún
            job lo pise. Al guardar, la serie sale de la lista.
          </p>
          {missing.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
              Todas las series tienen autor. 🎉
            </p>
          ) : (
            <ul className="space-y-1.5 rounded-xl border border-border bg-surface p-4">
              {missing.map((m) => (
                <li key={m.workId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{m.title}</span>
                    <span className="block truncate text-xs text-muted">{m.detail}</span>
                  </span>
                  <AuthorFix workId={m.workId} serieHref={m.serieHref} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

function Tab({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition ${
        active
          ? "border-accent text-foreground"
          : "border-transparent text-muted hover:text-foreground"
      }`}
    >
      {label} <span className="text-muted">({count})</span>
    </Link>
  );
}
