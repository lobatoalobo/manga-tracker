import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getCatalogIntegrity, getWorksMissingCover } from "@/lib/adminChecks";
import { ADMIN_TASKS } from "@/lib/adminTasks";
import TaskRunner from "@/components/TaskRunner";
import WhakoomImportForm from "@/components/WhakoomImportForm";
import CleanupActions from "@/components/CleanupActions";
import CoverFix from "@/components/CoverFix";

export const metadata = { title: "Herramientas (admin) · Nakama" };

export default async function AdminToolsPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const [checks, missingCover] = await Promise.all([
    getCatalogIntegrity(),
    getWorksMissingCover(),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Herramientas</h1>
      <p className="mb-6 text-sm text-muted">
        Mantenimiento del catálogo: import, tareas y limpieza.
      </p>

      <section className="mb-8">
        <WhakoomImportForm />
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold">Tareas de mantenimiento</h2>
        <p className="mb-3 text-xs text-muted">
          <b>Simular</b> muestra qué cambiaría sin tocar nada; <b>Aplicar</b> lo
          ejecuta sobre la base de este entorno.
        </p>
        <TaskRunner tasks={ADMIN_TASKS} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Limpieza del catálogo</h2>
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
                <ul className="mt-3 max-h-96 space-y-1.5 overflow-y-auto border-t border-border pt-3">
                  {c.samples.map((s, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">
                          {s.url ? (
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent hover:underline"
                            >
                              {s.label} ↗
                            </a>
                          ) : (
                            s.label
                          )}
                        </span>
                        {s.detail && (
                          <span className="block truncate text-xs text-muted">
                            {s.detail}
                          </span>
                        )}
                      </span>
                      {s.editionId != null && (
                        <CleanupActions
                          editionId={s.editionId}
                          workId={s.workId}
                          label={s.label}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section id="sin-portada" className="mt-8 scroll-mt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Series sin portada</h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              missingCover.length === 0
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-amber-500/15 text-amber-300"
            }`}
          >
            {missingCover.length}
          </span>
        </div>
        <p className="mb-3 text-xs text-muted">
          Subí un archivo (📤) o pegá una URL: se guarda en R2 (propia) y queda
          bloqueada para que ningún job la pise. Al guardar, la serie sale de la
          lista.
        </p>
        {missingCover.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            Todas las series tienen portada. 🎉
          </p>
        ) : (
          <ul className="max-h-160 space-y-1.5 overflow-y-auto rounded-xl border border-border bg-surface p-4">
            {missingCover.map((m) => (
              <li
                key={m.workId}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate">{m.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {m.detail}
                  </span>
                </span>
                <CoverFix workId={m.workId} serieHref={m.serieHref} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
