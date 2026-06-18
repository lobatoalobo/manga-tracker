import Link from "next/link";
import { SignIn } from "@/components/AuthButtons";

/**
 * Landing para usuarios NO logueados: propuesta de valor + CTAs (entrar /
 * explorar) en vez de mandarlos directo al catálogo sin contexto. Las portadas
 * del catálogo se usan como collage de fondo (decorativo).
 */
export default function Landing({ covers }: { covers: string[] }) {
  return (
    <main className="relative mx-auto max-w-6xl overflow-hidden px-5 pb-16 pt-6">
      {covers.length > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 flex justify-center gap-2 overflow-hidden opacity-15 [mask-image:linear-gradient(to_bottom,black,transparent)]"
        >
          {covers.map((c, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={c}
              alt=""
              className="h-44 w-28 shrink-0 rounded-lg object-cover sm:h-60 sm:w-40"
            />
          ))}
        </div>
      )}

      <div className="relative mx-auto max-w-2xl pt-12 text-center sm:pt-20">
        <h1 className="text-3xl font-bold leading-tight sm:text-5xl">
          Tu colección de manga, ordenada
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted sm:text-lg">
          Seguí tus series de las editoriales argentinas, marcá los tomos que
          tenés y enterate apenas sale uno nuevo o una reedición.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <SignIn className="rounded-lg bg-accent px-5 py-2.5 font-medium text-white transition hover:opacity-90" />
          <Link
            href="/catalogo"
            className="rounded-lg border border-border px-5 py-2.5 font-medium transition hover:border-accent"
          >
            Explorar catálogo
          </Link>
        </div>

        <ul className="mx-auto mt-12 grid max-w-xl gap-3 text-left sm:grid-cols-3">
          <Feature
            icon="📚"
            title="Tu colección"
            desc="Los tomos que tenés y los que te faltan, por edición."
          />
          <Feature
            icon="🔔"
            title="Avisos"
            desc="Tomo nuevo, reedición o estreno en Argentina."
          />
          <Feature
            icon="🛒"
            title="Deseados"
            desc="Qué te falta comprar y dónde conseguirlo."
          />
        </ul>
      </div>
    </main>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <span className="text-xl">{icon}</span>
      <p className="mt-1 text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{desc}</p>
    </li>
  );
}
