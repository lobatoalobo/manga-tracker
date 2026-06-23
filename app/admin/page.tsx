import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getCatalogIntegrity, getWorksMissingCover } from "@/lib/adminChecks";
import { getDuplicateWorkGroups } from "@/lib/mergeWorks";
import { getAuthorVariantClusters, getWorksMissingAuthor } from "@/lib/authorMerge";
import { countPendingReports } from "@/lib/reports";
import { countPendingStores } from "@/lib/stores";
import { countPendingIndieWorks } from "@/lib/indie";

export const metadata = { title: "Admin · Nakama" };

export default async function AdminHome() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const [edCounts, integrity, reports, stores, indie, works, upcoming, missingCover, dups, authorDups, missingAuthor] =
    await Promise.all([
      prisma.publisherEdition.groupBy({ by: ["publisher"], _count: { _all: true } }),
      getCatalogIntegrity(),
      countPendingReports(),
      countPendingStores(),
      countPendingIndieWorks(),
      prisma.work.count(),
      prisma.work.count({ where: { upcoming: true } }),
      getWorksMissingCover(),
      getDuplicateWorkGroups(),
      getAuthorVariantClusters(),
      getWorksMissingAuthor(),
    ]);

  const editorials = edCounts
    .map((r) => ({ publisher: r.publisher, total: r._count._all }))
    .sort((a, b) => b.total - a.total);
  const total = editorials.reduce((s, e) => s + e.total, 0);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <h1 className="mb-6 text-2xl font-bold">Admin</h1>

      {/* Pendientes de moderación */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">
        Pendientes
      </h2>
      <div className="mb-8 grid grid-cols-3 gap-3">
        <Stat href="/admin/reportes" label="Reportes" value={reports} alert={reports > 0} />
        <Stat href="/admin/tiendas" label="Tiendas" value={stores} alert={stores > 0} />
        <Stat href="/admin/independientes" label="Indie" value={indie} alert={indie > 0} />
      </div>

      {/* Catálogo */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">
        Catálogo
      </h2>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Ediciones" value={total} />
        <Stat label="Obras" value={works} />
        <Stat label="🔜 Preventas" value={upcoming} />
        <Stat
          href="/admin/duplicados"
          label="🔀 Series duplicadas"
          value={dups.length}
          alert={dups.length > 0}
        />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          href="/admin/herramientas#sin-portada"
          label="🖼 Sin portada"
          value={missingCover.length}
          alert={missingCover.length > 0}
        />
        <Stat
          href="/admin/autores"
          label="✍️ Autores a unificar"
          value={authorDups.length}
          alert={authorDups.length > 0}
        />
        <Stat
          href="/admin/autores?tab=sin-autor"
          label="✍️ Series sin autor"
          value={missingAuthor.length}
          alert={missingAuthor.length > 0}
        />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {editorials.map((e) => (
          <Link
            key={e.publisher}
            href={`/catalogo?pub=${encodeURIComponent(e.publisher)}`}
            className="rounded-xl border border-border bg-surface p-3 transition hover:border-accent"
          >
            <p className="text-sm font-medium">{e.publisher}</p>
            <p className="mt-1 text-sm">
              <span className="font-semibold">{e.total}</span>{" "}
              <span className="text-muted">en catálogo</span>
            </p>
          </Link>
        ))}
      </div>

      {/* Integridad */}
      {integrity.some((c) => c.count > 0) && (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">
            Integridad
          </h2>
          <div className="mb-3 space-y-2">
            {integrity
              .filter((c) => c.count > 0)
              .map((c) => (
                <div
                  key={c.key}
                  className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.title}</p>
                    <p className="truncate text-xs text-muted">{c.hint}</p>
                  </div>
                  <span className="ml-3 shrink-0 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-sm font-semibold text-amber-300">
                    {c.count}
                  </span>
                </div>
              ))}
          </div>
          <p className="mb-8 text-xs text-muted">
            Revisá y borrá desde{" "}
            <Link href="/admin/herramientas" className="text-accent hover:underline">
              Herramientas → Limpieza del catálogo
            </Link>
            .
          </p>
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  href,
  alert,
}: {
  label: string;
  value: number;
  href?: string;
  alert?: boolean;
}) {
  const inner = (
    <div
      className={`rounded-xl border bg-surface p-4 text-center transition ${
        alert ? "border-amber-500/40" : "border-border"
      } ${href ? "hover:border-accent" : ""}`}
    >
      <p className={`text-2xl font-bold ${alert ? "text-amber-300" : ""}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
