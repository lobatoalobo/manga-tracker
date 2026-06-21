import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getCatalogIntegrity } from "@/lib/adminChecks";
import { getJobRuns } from "@/lib/jobs";
import { ADMIN_TASKS } from "@/lib/adminTasks";
import TaskRunner from "@/components/TaskRunner";
import WhakoomImportForm from "@/components/WhakoomImportForm";

export const metadata = { title: "Herramientas (admin) · Nakama" };

export default async function AdminToolsPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const [checks, jobs] = await Promise.all([getCatalogIntegrity(), getJobRuns(15)]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Herramientas</h1>
      <p className="mb-6 text-sm text-muted">
        Mantenimiento del catálogo: import, tareas y chequeos de integridad.
      </p>

      <section className="mb-8">
        <WhakoomImportForm />
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold">Tareas de mantenimiento</h2>
        <p className="mb-3 text-xs text-muted">
          <b>Simular</b> muestra qué cambiaría sin tocar nada; <b>Aplicar</b> lo
          ejecuta sobre la base de este entorno y lo registra abajo.
        </p>
        <TaskRunner tasks={ADMIN_TASKS} />
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
                        <a
                          href={s.href}
                          className="text-accent hover:underline"
                        >
                          {s.label}
                        </a>
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
