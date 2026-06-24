import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { getWorksMissingSynopsis } from "@/lib/adminChecks";
import { translatorConfigured } from "@/lib/translate";
import SynopsisFix from "@/components/SynopsisFix";

export const metadata = { title: "Sinopsis incompletas (admin) · Nakama" };

/**
 * Series a las que les falta una versión de sinopsis (ES o EN). Si una está, se
 * traduce a la otra con el LLM; si faltan las dos, carga manual. Ver
 * docs/analisis-sistema-datos.md.
 */
export default async function AdminSinopsisPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  const items = await getWorksMissingSynopsis();
  const hasTranslator = translatorConfigured();

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <Link href="/admin" className="text-sm text-muted hover:text-foreground">
        ← Admin
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">Sinopsis incompletas</h1>
      <p className="mb-4 text-sm text-muted">
        Falta la versión ES o EN. Si una está, <b>Traducir</b> completa la otra con
        el LLM (queda marcada “auto”); si faltan las dos, cargalas a mano. Al tener
        las dos, la serie sale de la lista.
      </p>
      {!hasTranslator && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          ⚠️ Falta configurar <span className="font-mono">DEEPL_API_KEY</span> o{" "}
          <span className="font-mono">ANTHROPIC_API_KEY</span> en el entorno. Sin
          eso el botón “Traducir” no funciona (la carga manual sí).
        </p>
      )}

      {items.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          Todas las series tienen ambas versiones de sinopsis. 🎉
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <SynopsisFix
              key={it.workId}
              workId={it.workId}
              serieHref={it.serieHref}
              title={it.title}
              es={it.es}
              en={it.en}
              esAuto={it.esAuto}
              enAuto={it.enAuto}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
