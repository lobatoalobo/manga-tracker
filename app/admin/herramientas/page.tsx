import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getCatalogIntegrity } from "@/lib/adminChecks";
import FlushCacheButton from "@/components/FlushCacheButton";

export const metadata = { title: "Herramientas (admin) · Nakama" };

export default async function AdminToolsPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const checks = await getCatalogIntegrity();

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
