import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";

export const metadata = { title: "Scripts (admin) · Nakama" };

interface Script {
  cmd: string;
  desc: string;
}
interface Group {
  title: string;
  scripts: Script[];
}

const GROUPS: Group[] = [
  {
    title: "Catálogo / seed",
    scripts: [
      {
        cmd: "npm run seed:whakoom -- --reset",
        desc: "Siembra el catálogo desde Whakoom (Ivrea/Panini/Ovni, secuencial y resumable).",
      },
      {
        cmd: "npx tsx scripts/crawl.ts whakoom-all",
        desc: "Actualiza TODO el catálogo de Whakoom (Panini/Ovni/Utopía/Kemuri/Larp/Distrito) + notifica tomos nuevos. Correr LOCAL (Whakoom bloquea a los runners). Es lo que avisa el banner del home.",
      },
      {
        cmd: "npm run import:whakoom -- <url>",
        desc: "Importa una edición puntual desde una URL de Whakoom (/ediciones/<id>/…).",
      },
    ],
  },
  {
    title: "Depuración",
    scripts: [
      {
        cmd: "npx tsx scripts/flag-comics.ts",
        desc: "LISTA (sin --apply) los posibles cómics occidentales. Ya NO se recomienda borrarlos: los cómics se quedan; a futuro se clasifican con un campo de tipo (manga/cómic/novela/artbook/databook).",
      },
      {
        cmd: "npx tsx scripts/depurate-catalog.ts --apply",
        desc: "Deja 1 edición regular por (obra, editorial); borra specials/duplicados + works huérfanos.",
      },
      {
        cmd: "npx tsx scripts/dedup-sources.ts --apply",
        desc: "Dedup crawl↔Whakoom (misma serie cargada por dos fuentes, mismo título).",
      },
      {
        cmd: "npx tsx scripts/consolidate-dups.ts --apply",
        desc: "Consolida 'Posibles duplicados' (misma editorial+título+tomos): junta anilistId + link real de la editorial en una, borra la sobrante.",
      },
      {
        cmd: "npx tsx scripts/split-homonyms.ts --apply",
        desc: "Separa homónimos fusionados en un mismo Work (Citrus / Citrus+).",
      },
    ],
  },
  {
    title: "Enriquecimiento / mapeo",
    scripts: [
      {
        cmd: "npx tsx scripts/auto-map.ts [utopia|kemuri|…] --apply",
        desc: "Mapea a AniList las ediciones sin mapear (por título original + autor). Acepta una editorial. Después: depurate.",
      },
      {
        cmd: "npx tsx scripts/backfill-work-authors.ts [utopia|…] --apply",
        desc: "Rellena Work.author desde Whakoom (el import viejo no lo guardaba). Necesario para que Auto/auto-map resuelvan por autor. Correr ANTES de auto-map.",
      },
      {
        cmd: "npx tsx scripts/fix-broken-maps.ts --apply",
        desc: "Arregla series que tiran 404: ediciones mapeadas a un id que no es manga (ej. id de anime). Re-resuelve o las desmapea.",
      },
      {
        cmd: "npx tsx scripts/enrich-covers.ts",
        desc: "Rellena portadas de AniList en works mapeados que no tienen foto.",
      },
      {
        cmd: "npx tsx scripts/fix-ivrea-urls.ts --apply",
        desc: "Corrige URLs de Ivrea (de Whakoom → sitio real, validado) y sincroniza el conteo de tomos.",
      },
      {
        cmd: "npx tsx scripts/fix-panini-urls.ts --apply",
        desc: "Pone el link de búsqueda de Panini (solo URL, no toca tomos).",
      },
    ],
  },
  {
    title: "Preventas / pruebas",
    scripts: [
      {
        cmd: "npx tsx scripts/test-preventa.ts [anilistId]",
        desc: "Prueba el flow de preventa: 0 tomos → tomo 1 → desmarca upcoming + notifica. Default Ichi (180752).",
      },
      {
        cmd: "npx tsx scripts/reset-preventa.ts [anilistId]",
        desc: "Restaura una serie a preventa (0 tomos, upcoming) y limpia notis de prueba, para re-testear.",
      },
      {
        cmd: "npx tsx scripts/push-test.ts [email]",
        desc: "Manda un push de prueba a un usuario para verificar la entrega con la app cerrada.",
      },
    ],
  },
];

export default async function AdminScriptsPage() {
  const session = await auth();
  if (!isAdmin(session?.user?.email)) notFound();

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-bold">Scripts</h1>
      <p className="mb-6 text-sm text-muted">
        Todos corren <b className="text-foreground">local</b> contra la DB de prod
        (Whakoom/Ivrea bloquean a Vercel). Dry-run por defecto donde aplica;{" "}
        <code className="text-foreground">--apply</code> ejecuta. Usá{" "}
        <code className="text-foreground">npx tsx … --apply</code> directo (npm se
        come el flag).
      </p>

      <div className="space-y-6">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent">
              {g.title}
            </h2>
            <ul className="space-y-2">
              {g.scripts.map((s) => (
                <li
                  key={s.cmd}
                  className="rounded-xl border border-border bg-surface p-3"
                >
                  <code className="block select-all break-all text-sm text-foreground">
                    {s.cmd}
                  </code>
                  <p className="mt-1 text-xs text-muted">{s.desc}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
