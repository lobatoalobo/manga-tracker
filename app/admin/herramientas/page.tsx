import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getCatalogIntegrity } from "@/lib/adminChecks";
import { ADMIN_TASKS } from "@/lib/adminTasks";
import TaskRunner from "@/components/TaskRunner";
import WhakoomImportForm from "@/components/WhakoomImportForm";
import EditionDeleteButton from "@/components/EditionDeleteButton";

export const metadata = { title: "Herramientas (admin) · Nakama" };

export default async function AdminToolsPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const checks = await getCatalogIntegrity();

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
                        <span className="truncate">{s.label}</span>
                        {s.detail && (
                          <span className="block truncate text-xs text-muted">
                            {s.detail}
                          </span>
                        )}
                      </span>
                      {s.editionId != null && (
                        <EditionDeleteButton id={s.editionId} label={s.label} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
