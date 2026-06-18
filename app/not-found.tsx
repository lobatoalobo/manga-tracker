import Link from "next/link";

export const metadata = { title: "No encontrado" };

/**
 * 404 propio (para rutas inexistentes y para todo `notFound()`: fichas/series/
 * autores que no existen). Mantiene la nav y empuja al catálogo en vez del 404
 * pelado de Next.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-5 py-12 text-center">
      <p className="text-4xl">🔍</p>
      <h1 className="text-xl font-semibold">No encontramos esto</h1>
      <p className="text-sm text-muted">
        El enlace puede estar roto o la serie todavía no está en el catálogo.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <Link
          href="/catalogo"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Explorar catálogo
        </Link>
        <Link
          href="/"
          className="rounded-lg border border-border px-4 py-2 text-sm transition hover:border-accent"
        >
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
