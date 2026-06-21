import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getMappingHealth } from "@/lib/mappingHealth";
import { getCatalogFlags } from "@/lib/catalog";
import { getCatalogIntegrity } from "@/lib/adminChecks";
import { getDuplicateWorkGroups } from "@/lib/mergeWorks";
import { getJobRuns } from "@/lib/jobs";
import { countPendingReports } from "@/lib/reports";
import { countPendingStores } from "@/lib/stores";
import { countPendingIndieWorks } from "@/lib/indie";

export const metadata = { title: "Admin · Nakama" };

export default async function AdminHome() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const [health, integrity, jobs, reports, stores, indie, works, upcoming, flags, dups] =
    await Promise.all([
      getMappingHealth(),
      getCatalogIntegrity(),
      getJobRuns(6),
      countPendingReports(),
      countPendingStores(),
      countPendingIndieWorks(),
      prisma.work.count(),
      prisma.work.count({ where: { upcoming: true } }),
      getCatalogFlags(),
      getDuplicateWorkGroups(),
    ]);

  const total = health.publishers.reduce((s, p) => s + p.total, 0);
  const mapped = health.publishers.reduce((s, p) => s + p.mapped, 0);
  const national = health.publishers.reduce((s, p) => s + p.national, 0);
  const unmapped = total - mapped - national;

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
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Ediciones" value={total} />
        <Stat label="Mapeadas" value={mapped} />
        <Stat label="Nacionales" value={national + unmapped} />
        <Stat label="Obras" value={works} />
        <Stat label="🔜 Preventas" value={upcoming} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Stat
          href="/admin/mapeos?estado=nocover"
          label="🖼 Sin portada"
          value={flags.noCover}
          alert={flags.noCover > 0}
        />
        <Stat
          href="/admin/duplicados"
          label="🔀 Series duplicadas"
          value={dups.length}
          alert={dups.length > 0}
        />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {health.publishers
          .filter((p) => p.total > 0)
          .map((p) => (
            <Link
              key={p.publisher}
              href={`/admin/mapeos?ed=${slugFor(p.label)}`}
              className="rounded-xl border border-border bg-surface p-3 transition hover:border-accent"
            >
              <p className="text-sm font-medium">{p.label}</p>
              <p className="mt-1 text-sm">
                <span className="font-semibold">{p.total}</span>{" "}
                <span className="text-muted">en catálogo</span>
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {p.mapped} con AniList (extras)
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
            Muchos se resuelven solos desde{" "}
            <Link href="/admin/herramientas" className="text-accent hover:underline">
              Herramientas → tareas
            </Link>{" "}
            (Simular / Aplicar).
          </p>
        </>
      )}

      {/* Últimos jobs */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">
        Últimos jobs
      </h2>
      <ul className="space-y-1 text-sm">
        {jobs.length === 0 ? (
          <li className="text-muted">Sin corridas registradas.</li>
        ) : (
          jobs.map((j) => (
            <li key={j.id} className="flex justify-between rounded-lg bg-surface px-3 py-2">
              <span className="truncate">
                {j.status === "ERROR" ? "❌" : "✓"} {j.kind}
                {j.label ? ` · ${j.label}` : ""}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {j.imported}↑ · {j.finishedAt.toLocaleDateString("es-AR")}
              </span>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}

function slugFor(label: string): string {
  return label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
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
