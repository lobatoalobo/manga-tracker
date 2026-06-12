import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getCatalogIntegrity } from "@/lib/adminChecks";
import { getMappingHealth } from "@/lib/mappingHealth";
import { getJobRuns } from "@/lib/jobs";
import FlushCacheButton from "@/components/FlushCacheButton";

export const metadata = { title: "Herramientas (admin) · Nakama" };

export default async function AdminToolsPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const [checks, health, jobs] = await Promise.all([
    getCatalogIntegrity(),
    getMappingHealth(),
    getJobRuns(15),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Herramientas</h1>
      <p className="mb-6 text-sm text-muted">
        Caché y chequeos de integridad del catálogo.
      </p>

      <section className="mb-8 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold">Caché de ediciones</h2>
        <p className="mb-3 mt-1 text-sm text-muted">
          Vaciá la caché cuando edites datos de ediciones y no se reflejen
          (links de tienda, tomos, mapeos). Se reconstruye sola al visitar cada
          ficha.
        </p>
        <FlushCacheButton />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Salud de mapeos</h2>
        <div className="mb-4 grid grid-cols-3 gap-3">
          {health.publishers.map((p) => (
            <div
              key={p.publisher}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <p className="text-sm font-medium">{p.label}</p>
              <p className="mt-1 text-lg font-semibold text-emerald-300">
                {p.mapped}
                <span className="text-sm font-normal text-muted">
                  {" "}
                  / {p.total}
                </span>
              </p>
              <div className="mt-0.5 flex flex-col">
                {p.unmapped > 0 && (
                  <Link
                    href={`/admin/mapeos?estado=unmapped&ed=${
                      p.label.toLowerCase().split(" ")[0]
                    }`}
                    className="text-xs text-amber-400 hover:underline"
                  >
                    {p.unmapped} sin mapear
                  </Link>
                )}
                {p.national > 0 && (
                  <Link
                    href={`/admin/mapeos?estado=national&ed=${
                      p.label.toLowerCase().split(" ")[0]
                    }`}
                    className="text-xs text-sky-300 hover:underline"
                  >
                    {p.national} nacional-only
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>

        <Suspicious
          title="Mismo título → distintas series (homónimos)"
          hint="Revisá que cada uno apunte a la serie correcta."
          groups={health.homonyms}
        />
        <Suspicious
          title="Una editorial con varias entradas → misma serie"
          hint="Posible spin-off mal mapeado (ej. AoT: Before the Fall → AoT)."
          groups={health.overmerges}
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Últimas corridas (jobs)</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay corridas registradas.</p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => {
              const reasons =
                (j.summary as { reasons?: Record<string, number> } | null)
                  ?.reasons ?? null;
              return (
                <li
                  key={j.id}
                  className="rounded-xl border border-border bg-surface p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {j.kind}
                      {j.status === "ERROR" && (
                        <span className="ml-2 text-red-400">ERROR</span>
                      )}
                    </span>
                    <span className="text-xs text-muted">
                      {j.finishedAt.toLocaleString("es-AR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {j.processed} procesadas · {j.imported} importadas ·{" "}
                    {j.mapped} mapeadas · {j.skipped} salteadas
                    {j.label ? ` · ${j.label}` : ""}
                  </p>
                  {reasons && Object.keys(reasons).length > 0 && (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {Object.entries(reasons)
                        .sort((a, b) => b[1] - a[1])
                        .map(([r, n]) => (
                          <li
                            key={r}
                            className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted"
                          >
                            {r}: {n}
                          </li>
                        ))}
                    </ul>
                  )}
                  {j.error && (
                    <p className="mt-1 text-xs text-red-400">{j.error}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Integridad del catálogo</h2>
        <div className="space-y-4">
          {checks.map((c) => (
            <div
              key={c.key}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">{c.title}</h3>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    c.count === 0
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-amber-500/15 text-amber-300"
                  }`}
                >
                  {c.count}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">{c.hint}</p>

              {c.samples.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                  {c.samples.map((s, i) => (
                    <li key={i} className="text-sm">
                      {s.href ? (
                        <Link
                          href={s.href}
                          className="text-accent hover:underline"
                        >
                          {s.label}
                        </Link>
                      ) : (
                        s.label
                      )}
                      {s.detail && (
                        <span className="text-muted"> · {s.detail}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {c.count > c.samples.length && (
                <p className="mt-2 text-xs text-muted">
                  … y {c.count - c.samples.length} más
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Suspicious({
  title,
  hint,
  groups,
}: {
  title: string;
  hint: string;
  groups: { key: string; detail: string; items: { label: string; href: string }[] }[];
}) {
  return (
    <div className="mt-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            groups.length === 0
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {groups.length}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
      {groups.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-border pt-3">
          {groups.map((g) => (
            <li key={g.key} className="text-sm">
              <span className="font-medium">{g.key}</span>{" "}
              <span className="text-xs text-muted">· {g.detail}</span>
              <span className="ml-2 inline-flex flex-wrap gap-2">
                {g.items.map((it, i) => (
                  <Link
                    key={i}
                    href={it.href}
                    className="text-xs text-accent hover:underline"
                  >
                    {it.label}
                  </Link>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
