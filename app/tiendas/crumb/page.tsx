import Link from "next/link";
import { CRUMB_URL, CRUMB_MANGA_CATEGORIES } from "@/lib/crumb";

export const metadata = { title: "Espacio Crumb · Nakama" };

export default function CrumbPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link href="/tiendas" className="text-sm text-accent hover:underline">
        ← Tiendas
      </Link>

      <div className="mt-4 rounded-2xl border border-accent/40 bg-gradient-to-b from-accent/10 to-transparent p-6">
        <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-white">
          ★ Tienda amiga
        </span>
        <h1 className="mt-3 text-2xl font-bold">Espacio Crumb</h1>
        <p className="mt-1 text-muted">
          Almacén de historietas y afines · La Plata
        </p>
        <p className="mt-3 text-sm text-muted">
          El principal referente local de la historieta: material nacional de
          todos los tiempos, cómics y manga de las editoriales argentinas.
        </p>
        <a
          href={CRUMB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
        >
          Visitar la tienda ↗
        </a>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">Manga por editorial</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CRUMB_MANGA_CATEGORIES.map((c) => (
          <a
            key={c.path}
            href={`${CRUMB_URL}${c.path}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-border bg-surface p-4 text-center text-sm font-medium transition hover:border-accent"
          >
            {c.label} ↗
          </a>
        ))}
      </div>

      <p className="mt-8 text-sm text-muted">
        Desde cualquier serie nacional en Nakama vas a encontrar un botón{" "}
        <span className="text-accent">🛒 Comprar en Crumb</span> para buscarla
        directo en la tienda.
      </p>
    </main>
  );
}
